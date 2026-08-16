export type ConversationRoute =
  | 'GREETING'
  | 'INTERACTIVE_ACTION'
  | 'MANUAL_MENU'
  | 'AI_KNOWLEDGE'
  | 'AI_FREE_TEXT'
  | 'AI_TOOL'
  | 'HUMAN_FALLBACK';

export type ConversationRoutingDecision = {
  route: ConversationRoute;
  suggestedToolId: string | null;
};

export class ConversationRouter {
  public route(input: {
    body: string;
    messageType?: string;
    hasManualSelection?: boolean;
    knowledgeMatchCount?: number;
  }): ConversationRoutingDecision {
    if (input.messageType === 'interactive' || input.messageType === 'button') {
      return { route: 'INTERACTIVE_ACTION', suggestedToolId: null };
    }
    if (input.hasManualSelection === true) {
      return { route: 'MANUAL_MENU', suggestedToolId: null };
    }
    const value = normalizeSelection(input.body);
    if (/^(?:hola|holi|buen(?:os)? dias|buenas (?:tardes|noches)|que tal|saludos)$/u.test(value)) {
      return { route: 'GREETING', suggestedToolId: 'show_menu' };
    }
    const tool = suggestedTool(value);
    if (tool !== null) return { route: 'AI_TOOL', suggestedToolId: tool };
    if (/\b(?:humano|persona|ejecutivo|agente)\b/iu.test(value)) {
      return { route: 'HUMAN_FALLBACK', suggestedToolId: null };
    }
    return {
      route: (input.knowledgeMatchCount ?? 0) > 0 ? 'AI_KNOWLEDGE' : 'AI_FREE_TEXT',
      suggestedToolId: null,
    };
  }
}

function normalizeSelection(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function suggestedTool(value: string): string | null {
  if (/\b(?:horario|horarios|hora de atencion|cuando abren|cuando cierran)\b/u.test(value)) {
    return 'get_business_hours';
  }
  if (/\b(?:servicio|servicios|prestaciones|que hacen)\b/u.test(value)) return 'get_services';
  if (/\b(?:producto|productos|catalogo|venden)\b/u.test(value)) return 'get_products';
  if (/\b(?:stock|inventario|unidades disponibles)\b/u.test(value)) return 'get_product_stock';
  if (/\b(?:direccion|ubicacion|donde estan|como llegar|sucursal)\b/u.test(value)) {
    return 'get_locations';
  }
  if (/\b(?:hora disponible|horas disponibles|disponibilidad|reservar|reserva)\b/u.test(value)) {
    return 'get_available_slots';
  }
  return null;
}
