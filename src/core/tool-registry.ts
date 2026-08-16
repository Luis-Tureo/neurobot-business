import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  AssistantToolConfiguration,
  ToolAvailability,
  ToolExecutionResult,
  ToolPermission,
  ToolResultItem,
} from '../domain/types.js';
import type { AppDatabase } from '../persistence/database.js';

type ToolInput = Record<string, string | number | boolean | null>;

export type ToolDescriptor = {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permissions: ToolPermission[];
  availability: ToolAvailability;
  state: 'ENABLED' | 'DISABLED' | 'FUTURE';
  businessScoped: true;
};

type RegisteredTool = Omit<ToolDescriptor, 'state'> & {
  schema: z.ZodType<ToolInput>;
  handler?: (assistantId: string, input: ToolInput) => ToolData;
  revalidate?: (assistantId: string, resourceId: string) => boolean;
};

type ToolData = {
  message: string;
  items: ToolResultItem[];
};

export class ToolRegistryError extends Error {
  public constructor(
    public readonly code:
      | 'TOOL_NOT_FOUND'
      | 'TOOL_NOT_AVAILABLE'
      | 'TOOL_DISABLED'
      | 'TOOL_TENANT_MISMATCH'
      | 'TOOL_UNAUTHORIZED'
      | 'TOOL_PERMISSION_DENIED'
      | 'TOOL_INVALID_INPUT'
      | 'TOOL_RESOURCE_STALE',
    message: string,
  ) {
    super(message);
    this.name = 'ToolRegistryError';
  }
}

export class ToolRegistry {
  private readonly tools: Map<string, RegisteredTool>;

  public constructor(private readonly database: AppDatabase) {
    this.tools = new Map(this.buildTools().map((tool) => [tool.id, tool]));
  }

  public list(assistantId: string): ToolDescriptor[] {
    const configurations = new Map(
      this.database
        .listAssistantToolConfigurations(assistantId)
        .map((configuration) => [configuration.toolId, configuration]),
    );
    return [...this.tools.values()].map((tool) => {
      const configuration = configurations.get(tool.id);
      return {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        permissions: configuration?.permissions ?? tool.permissions,
        availability: tool.availability,
        state:
          tool.availability === 'FUTURE'
            ? 'FUTURE'
            : configuration?.enabled === false
              ? 'DISABLED'
              : 'ENABLED',
        businessScoped: true,
      };
    });
  }

  public configuration(assistantId: string, toolId: string): AssistantToolConfiguration | null {
    return (
      this.database
        .listAssistantToolConfigurations(assistantId)
        .find((configuration) => configuration.toolId === toolId) ?? null
    );
  }

  public async execute(input: {
    assistantId: string;
    businessId: string;
    toolId: string;
    arguments: ToolInput;
    requiredPermissions: ToolPermission[];
    userAuthorized: boolean;
  }): Promise<ToolExecutionResult> {
    const tool = this.tools.get(input.toolId);
    if (tool === undefined) {
      throw new ToolRegistryError('TOOL_NOT_FOUND', 'La herramienta solicitada no existe.');
    }
    if (tool.availability !== 'AVAILABLE' || tool.handler === undefined) {
      throw new ToolRegistryError(
        'TOOL_NOT_AVAILABLE',
        'La herramienta todavía no está disponible.',
      );
    }
    const assistant = this.database.getBot(input.assistantId);
    if (assistant === null || assistant.businessId !== input.businessId) {
      throw new ToolRegistryError(
        'TOOL_TENANT_MISMATCH',
        'La herramienta no pertenece al negocio solicitado.',
      );
    }
    if (!input.userAuthorized) {
      throw new ToolRegistryError('TOOL_UNAUTHORIZED', 'El usuario no está autorizado.');
    }
    const configuration = this.configuration(input.assistantId, input.toolId);
    if (configuration === null || !configuration.enabled) {
      throw new ToolRegistryError('TOOL_DISABLED', 'La herramienta no está habilitada.');
    }
    if (
      input.requiredPermissions.some(
        (permission) => !configuration.permissions.includes(permission),
      )
    ) {
      throw new ToolRegistryError(
        'TOOL_PERMISSION_DENIED',
        'La herramienta no tiene los permisos requeridos.',
      );
    }
    const parsed = tool.schema.safeParse(input.arguments);
    if (!parsed.success) {
      throw new ToolRegistryError('TOOL_INVALID_INPUT', 'Los parámetros no son válidos.');
    }
    const result = tool.handler(input.assistantId, parsed.data);
    return {
      toolId: tool.id,
      executionId: `tool_${randomUUID().replaceAll('-', '')}`,
      message: result.message,
      items: result.items,
      resultCount: result.items.length,
      source: 'BUSINESS_DATA',
    };
  }

  public revalidate(assistantId: string, toolId: string, resourceId: string): void {
    const tool = this.tools.get(toolId);
    if (
      tool === undefined ||
      tool.revalidate === undefined ||
      !tool.revalidate(assistantId, resourceId)
    ) {
      throw new ToolRegistryError(
        'TOOL_RESOURCE_STALE',
        'La opción cambió y debe consultarse nuevamente.',
      );
    }
  }

  private buildTools(): RegisteredTool[] {
    const noInput = z.object({}).strict() as z.ZodType<ToolInput>;
    const readPermissions: ToolPermission[] = ['READ', 'SUGGEST'];
    const available = (
      value: Omit<RegisteredTool, 'availability' | 'businessScoped' | 'permissions'>,
    ): RegisteredTool => ({
      ...value,
      availability: 'AVAILABLE',
      businessScoped: true,
      permissions: readPermissions,
    });
    const future = (id: string, name: string, description: string): RegisteredTool => ({
      id,
      name,
      description,
      inputSchema: { type: 'object', additionalProperties: false },
      schema: noInput,
      permissions: ['EXECUTE'],
      availability: 'FUTURE',
      businessScoped: true,
    });

    return [
      available({
        id: 'get_business_hours',
        name: 'Ver horarios',
        description: 'Consulta los horarios confirmados del negocio.',
        inputSchema: { type: 'object', additionalProperties: false },
        schema: noInput,
        handler: (assistantId) => {
          const hours = this.database.listBusinessHours(assistantId);
          return {
            message:
              hours.length === 0
                ? 'No hay horarios confirmados en este momento.'
                : 'Estos son los horarios confirmados:',
            items: hours.map((hour) => ({
              resourceId: `business_hour:${hour.id}`,
              label: businessHourLabel(hour),
              ...(hour.label === '' ? {} : { description: hour.label }),
              volatile: false,
            })),
          };
        },
        revalidate: (assistantId, resourceId) => {
          const id = numericResourceId(resourceId, 'business_hour');
          return this.database.listBusinessHours(assistantId).some((hour) => hour.id === id);
        },
      }),
      available({
        id: 'get_services',
        name: 'Ver servicios',
        description: 'Consulta servicios activos guardados en el catálogo del negocio.',
        inputSchema: { type: 'object', additionalProperties: false },
        schema: noInput,
        handler: (assistantId) => catalogToolData(this.database, assistantId, 'services'),
        revalidate: (assistantId, resourceId) =>
          activeCatalogItem(this.database, assistantId, resourceId) !== null,
      }),
      available({
        id: 'get_products',
        name: 'Mostrar productos',
        description: 'Consulta productos activos guardados en el catálogo del negocio.',
        inputSchema: { type: 'object', additionalProperties: false },
        schema: noInput,
        handler: (assistantId) => catalogToolData(this.database, assistantId, 'products'),
        revalidate: (assistantId, resourceId) =>
          activeCatalogItem(this.database, assistantId, resourceId) !== null,
      }),
      available({
        id: 'get_product_stock',
        name: 'Ver stock informado',
        description: 'Consulta stock real registrado para un producto del catálogo.',
        inputSchema: {
          type: 'object',
          properties: { itemId: { type: 'integer', minimum: 1 }, name: { type: 'string' } },
          additionalProperties: false,
        },
        schema: z
          .object({
            itemId: z.number().int().positive().optional(),
            name: z.string().trim().min(1).max(160).optional(),
          })
          .strict()
          .refine(
            (value) => value.itemId !== undefined || value.name !== undefined,
          ) as z.ZodType<ToolInput>,
        handler: (assistantId, input) => {
          const items = this.database.listCatalogItems(assistantId).filter((item) => {
            if (!item.enabled || item.informedStock === null) return false;
            if (typeof input.itemId === 'number') return item.id === input.itemId;
            return item.name
              .toLocaleLowerCase('es')
              .includes(String(input.name).toLocaleLowerCase('es'));
          });
          return {
            message:
              items.length === 0
                ? 'No hay stock confirmado para ese producto.'
                : 'Este es el stock informado actualmente:',
            items: items.map((item) => ({
              resourceId: `catalog_item:${item.id}`,
              label: item.name,
              description: `${item.informedStock as number} unidades informadas`,
              volatile: true,
            })),
          };
        },
        revalidate: (assistantId, resourceId) => {
          const item = activeCatalogItem(this.database, assistantId, resourceId);
          return item !== null && item.informedStock !== null;
        },
      }),
      available({
        id: 'get_locations',
        name: 'Ver ubicación',
        description: 'Consulta la dirección confirmada en el perfil del negocio.',
        inputSchema: { type: 'object', additionalProperties: false },
        schema: noInput,
        handler: (assistantId) => {
          const address = this.database.getBotProfile(assistantId).address;
          return {
            message:
              address === null || address.trim() === ''
                ? 'No hay una ubicación confirmada.'
                : 'Esta es la ubicación confirmada:',
            items:
              address === null || address.trim() === ''
                ? []
                : [{ resourceId: 'location:primary', label: address, volatile: false }],
          };
        },
        revalidate: (assistantId, resourceId) =>
          resourceId === 'location:primary' &&
          (this.database.getBotProfile(assistantId).address?.trim() ?? '') !== '',
      }),
      available({
        id: 'show_menu',
        name: 'Mostrar menú',
        description: 'Muestra opciones persistentes configuradas por el administrador.',
        inputSchema: { type: 'object', additionalProperties: false },
        schema: noInput,
        handler: (assistantId) => {
          const menu = this.database
            .listMenus(assistantId)
            .find((candidate) => candidate.isInitial && candidate.enabled);
          const options =
            menu === undefined
              ? []
              : this.database
                  .listMenuOptions(assistantId, menu.id)
                  .filter((option) => option.enabled);
          return {
            message: menu?.message ?? 'No hay un menú activo.',
            items: options.map((option) => ({
              resourceId: `menu_option:${option.id}`,
              label: option.label,
              ...(option.description === '' ? {} : { description: option.description }),
              ...(option.section === '' ? {} : { section: option.section }),
              volatile: false,
            })),
          };
        },
        revalidate: (assistantId, resourceId) => {
          const id = numericResourceId(resourceId, 'menu_option');
          return this.database
            .listMenuOptions(assistantId)
            .some((option) => option.id === id && option.enabled);
        },
      }),
      future(
        'get_available_slots',
        'Disponibilidad de citas',
        'Requiere una agenda real conectada; no se simulan horarios.',
      ),
      future('get_order_status', 'Estado de pedidos', 'Requiere una fuente real de pedidos.'),
      future('create_booking', 'Crear reserva', 'Operación futura con revalidación obligatoria.'),
      future('cancel_booking', 'Cancelar reserva', 'Operación futura con reautorización.'),
      future('request_human', 'Hablar con humano', 'Derivación futura; no está activa.'),
    ];
  }
}

function catalogToolData(
  database: AppDatabase,
  assistantId: string,
  kind: 'services' | 'products',
): ToolData {
  const categories = database.listCatalogCategories(assistantId);
  const matchingCategoryIds = categories
    .filter((category) =>
      kind === 'services'
        ? /servic|consulta|atenci[oó]n/iu.test(category.name)
        : /product|tienda|venta|cat[aá]logo/iu.test(category.name),
    )
    .map((category) => category.id);
  const allItems = database.listCatalogItems(assistantId).filter((item) => item.enabled);
  const items =
    matchingCategoryIds.length === 0
      ? allItems
      : allItems.filter(
          (item) => item.categoryId !== null && matchingCategoryIds.includes(item.categoryId),
        );
  return {
    message:
      items.length === 0
        ? `No hay ${kind === 'services' ? 'servicios' : 'productos'} confirmados en el catálogo.`
        : `Estos son los ${kind === 'services' ? 'servicios' : 'productos'} activos:`,
    items: items.map((item) => ({
      resourceId: `catalog_item:${item.id}`,
      label: item.name,
      ...(catalogDescription(item) === undefined
        ? {}
        : { description: catalogDescription(item) as string }),
      volatile:
        item.informedStock !== null || item.priceAmount !== null || item.offerPriceAmount !== null,
    })),
  };
}

function activeCatalogItem(database: AppDatabase, assistantId: string, resourceId: string) {
  const id = numericResourceId(resourceId, 'catalog_item');
  return (
    database.listCatalogItems(assistantId).find((item) => item.id === id && item.enabled) ?? null
  );
}

function numericResourceId(resourceId: string, prefix: string): number {
  const match = new RegExp(`^${prefix}:(\\d+)$`, 'u').exec(resourceId);
  return match === null ? -1 : Number(match[1]);
}

function businessHourLabel(hour: ReturnType<AppDatabase['listBusinessHours']>[number]): string {
  const weekdays = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const day = hour.localDate ?? (hour.weekday === null ? 'Fecha' : weekdays[hour.weekday]);
  if (hour.closed) return `${day}: cerrado`;
  return `${day}: ${hour.openingTime ?? '--:--'}–${hour.closingTime ?? '--:--'}`;
}

function catalogDescription(
  item: ReturnType<AppDatabase['listCatalogItems']>[number],
): string | undefined {
  const details = [item.description, item.availability].filter((value) => value.trim() !== '');
  return details.length === 0 ? undefined : details.join(' · ').slice(0, 72);
}
