export type MetaTemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
export type TemplateBusinessUseCase = 'DELIVERY' | 'APPOINTMENTS' | 'GENERAL';

export type MetaTemplateDraft = {
  key: string;
  name: string;
  language: string;
  category: MetaTemplateCategory;
  useCase: TemplateBusinessUseCase;
  title: string;
  body: string;
  variables: Array<{ position: number; label: string; example: string }>;
  suggestedTrigger: string;
};

const DELIVERY_TEMPLATES: readonly MetaTemplateDraft[] = [
  {
    key: 'order_confirmed',
    name: 'pedido_confirmado',
    language: 'es_CL',
    category: 'UTILITY',
    useCase: 'DELIVERY',
    title: 'Pedido confirmado',
    body: 'Hola {{1}}. Recibimos correctamente tu pedido N.° {{2}}. Te avisaremos cuando esté listo.',
    variables: [
      { position: 1, label: 'Nombre del cliente', example: 'Camila' },
      { position: 2, label: 'Número de pedido', example: '1542' },
    ],
    suggestedTrigger: 'Cuando el pedido cambia al estado confirmado',
  },
  {
    key: 'order_dispatched',
    name: 'pedido_despachado',
    language: 'es_CL',
    category: 'UTILITY',
    useCase: 'DELIVERY',
    title: 'Pedido despachado',
    body: 'Hola {{1}}. Tu pedido N.° {{2}} ya fue despachado. La entrega estimada es {{3}}.',
    variables: [
      { position: 1, label: 'Nombre del cliente', example: 'Luis' },
      { position: 2, label: 'Número de pedido', example: '1542' },
      { position: 3, label: 'Fecha u horario estimado', example: 'hoy entre 16:00 y 18:00' },
    ],
    suggestedTrigger: 'Cuando el pedido cambia al estado despachado',
  },
  {
    key: 'delivery_rescheduled',
    name: 'entrega_reprogramada',
    language: 'es_CL',
    category: 'UTILITY',
    useCase: 'DELIVERY',
    title: 'Entrega reprogramada',
    body: 'Hola {{1}}. La entrega de tu pedido N.° {{2}} fue reprogramada para {{3}}.',
    variables: [
      { position: 1, label: 'Nombre del cliente', example: 'Daniela' },
      { position: 2, label: 'Número de pedido', example: '1678' },
      { position: 3, label: 'Nueva fecha u horario', example: '10 de agosto a las 15:30' },
    ],
    suggestedTrigger: 'Cuando el administrador reprograma una entrega',
  },
];

const APPOINTMENT_TEMPLATES: readonly MetaTemplateDraft[] = [
  {
    key: 'appointment_confirmed',
    name: 'hora_confirmada',
    language: 'es_CL',
    category: 'UTILITY',
    useCase: 'APPOINTMENTS',
    title: 'Hora confirmada',
    body: 'Hola {{1}}. Tu hora quedó confirmada para el día {{2}} a las {{3}}.',
    variables: [
      { position: 1, label: 'Nombre del cliente', example: 'Carlos' },
      { position: 2, label: 'Fecha', example: '10 de agosto' },
      { position: 3, label: 'Hora', example: '15:30' },
    ],
    suggestedTrigger: 'Inmediatamente después de confirmar la reserva',
  },
  {
    key: 'appointment_reminder',
    name: 'recordatorio_de_hora',
    language: 'es_CL',
    category: 'UTILITY',
    useCase: 'APPOINTMENTS',
    title: 'Recordatorio de hora',
    body: 'Hola {{1}}. Te recordamos que tienes una hora agendada para {{2}} a las {{3}}.',
    variables: [
      { position: 1, label: 'Nombre del cliente', example: 'María' },
      { position: 2, label: 'Fecha', example: 'mañana, 10 de agosto' },
      { position: 3, label: 'Hora', example: '11:00' },
    ],
    suggestedTrigger: 'Veinticuatro horas antes de la cita',
  },
  {
    key: 'appointment_rescheduled',
    name: 'hora_reprogramada',
    language: 'es_CL',
    category: 'UTILITY',
    useCase: 'APPOINTMENTS',
    title: 'Hora reprogramada',
    body: 'Hola {{1}}. Tu hora fue reprogramada para el día {{2}} a las {{3}}.',
    variables: [
      { position: 1, label: 'Nombre del cliente', example: 'Andrea' },
      { position: 2, label: 'Nueva fecha', example: '12 de agosto' },
      { position: 3, label: 'Nueva hora', example: '09:30' },
    ],
    suggestedTrigger: 'Cuando el administrador modifica una cita',
  },
];

export function recommendedTemplateDrafts(
  useCase: TemplateBusinessUseCase,
): MetaTemplateDraft[] {
  if (useCase === 'DELIVERY') return DELIVERY_TEMPLATES.map(cloneTemplate);
  if (useCase === 'APPOINTMENTS') return APPOINTMENT_TEMPLATES.map(cloneTemplate);
  return [];
}

function cloneTemplate(template: MetaTemplateDraft): MetaTemplateDraft {
  return {
    ...template,
    variables: template.variables.map((variable) => ({ ...variable })),
  };
}
