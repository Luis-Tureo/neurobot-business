import type { MenuActionType } from '../domain/types.js';

export type ActionExecutionContext<T> = {
  actionId: MenuActionType;
  assistantId: string;
  businessId: string;
  expectedBusinessId: string;
  userAuthorized: boolean;
  payload: Record<string, string | number | boolean | null>;
  perform: () => Promise<T>;
};

export type ActionDescriptor = {
  id: MenuActionType;
  name: string;
  description: string;
  permissions: Array<'READ' | 'SUGGEST' | 'EXECUTE'>;
  available: boolean;
  businessScoped: true;
};

type RegisteredAction = ActionDescriptor & {
  handler: <T>(context: ActionExecutionContext<T>) => Promise<T>;
};

export class ActionRegistryError extends Error {
  public constructor(
    public readonly code:
      | 'ACTION_NOT_FOUND'
      | 'ACTION_DISABLED'
      | 'ACTION_TENANT_MISMATCH'
      | 'ACTION_UNAUTHORIZED'
      | 'ACTION_INVALID_PAYLOAD',
    message: string,
  ) {
    super(message);
    this.name = 'ActionRegistryError';
  }
}

export class ActionRegistry {
  private readonly actions: Map<MenuActionType, RegisteredAction>;

  public constructor() {
    const execute = async <T>(context: ActionExecutionContext<T>): Promise<T> => context.perform();
    this.actions = new Map(
      actionDescriptors().map((descriptor) => [descriptor.id, { ...descriptor, handler: execute }]),
    );
  }

  public list(): ActionDescriptor[] {
    return [...this.actions.values()].map(({ handler: _handler, ...descriptor }) => descriptor);
  }

  public async execute<T>(context: ActionExecutionContext<T>): Promise<T> {
    const action = this.actions.get(context.actionId);
    if (action === undefined) {
      throw new ActionRegistryError('ACTION_NOT_FOUND', 'La acción no existe.');
    }
    if (!action.available) {
      throw new ActionRegistryError('ACTION_DISABLED', 'La acción no está disponible.');
    }
    if (context.businessId !== context.expectedBusinessId) {
      throw new ActionRegistryError(
        'ACTION_TENANT_MISMATCH',
        'La acción no pertenece al negocio solicitado.',
      );
    }
    if (!context.userAuthorized) {
      throw new ActionRegistryError('ACTION_UNAUTHORIZED', 'El usuario no está autorizado.');
    }
    if (JSON.stringify(context.payload).length > 1000) {
      throw new ActionRegistryError(
        'ACTION_INVALID_PAYLOAD',
        'La acción contiene datos inválidos.',
      );
    }
    return action.handler(context);
  }
}

function actionDescriptors(): ActionDescriptor[] {
  const readOnly: MenuActionType[] = [
    'text',
    'catalog_item',
    'catalog_category',
    'media',
    'submenu',
    'knowledge',
    'ai',
    'hours',
    'address',
    'payments',
    'shipping',
    'back',
    'exit',
  ];
  return [
    ...readOnly.map((id) => ({
      id,
      name: id,
      description: 'Acción persistente configurada por el administrador.',
      permissions: ['READ'] as Array<'READ'>,
      available: true,
      businessScoped: true as const,
    })),
    {
      id: 'human_assistance',
      name: 'Solicitud de atención humana',
      description: 'Registra una solicitud local sin ejecutar handoff de Meta.',
      permissions: ['EXECUTE'],
      available: true,
      businessScoped: true,
    },
    {
      id: 'reservation_request',
      name: 'Solicitud de reserva',
      description: 'Registra una solicitud; no confirma disponibilidad ni crea una reserva real.',
      permissions: ['EXECUTE'],
      available: true,
      businessScoped: true,
    },
  ];
}
