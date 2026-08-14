import type { AssistantProfile, OrganizationType } from '../domain/types.js';

export type ProfilePresetKey = 'store' | 'restaurant' | 'service' | 'empty';

export type ProfilePreset = {
  key: ProfilePresetKey;
  label: string;
  organizationType: OrganizationType;
  industry: string;
  objective: string;
  allowedTopics: string[];
  excludedTopics: string[];
  tone: string;
};

export const ORGANIZATION_TYPES: OrganizationType[] = [
  'Comercio',
  'Restaurante',
  'Servicios',
  'Salud',
  'Belleza',
  'Turismo',
  'Transporte',
  'Educación',
  'Profesional independiente',
  'Otro',
];

export const PROFILE_PRESETS: ProfilePreset[] = [
  {
    key: 'store',
    label: 'Comercio',
    organizationType: 'Comercio',
    industry: 'Comercio',
    objective:
      'Informar productos, precios, stock oficial, horarios, despachos, pagos, cambios y garantías.',
    allowedTopics: [
      'Productos',
      'Precios',
      'Stock oficial',
      'Horarios',
      'Despachos',
      'Pagos',
      'Cambios',
      'Garantías',
      'Contacto',
    ],
    excludedTopics: [
      'Confirmar compras',
      'Realizar cobros',
      'Prometer stock',
      'Acciones administrativas',
    ],
    tone: 'Cordial, comercial, preciso y breve.',
  },
  {
    key: 'restaurant',
    label: 'Restaurante',
    organizationType: 'Restaurante',
    industry: 'Gastronomía',
    objective:
      'Informar menú, precios, horarios, dirección, despacho, pagos y opciones alimentarias oficiales.',
    allowedTopics: [
      'Menú',
      'Precios',
      'Horarios',
      'Dirección',
      'Despacho',
      'Pagos',
      'Opciones alimentarias',
      'Contacto',
    ],
    excludedTopics: [
      'Confirmar reservas',
      'Realizar cobros',
      'Garantizar disponibilidad',
      'Acciones administrativas',
    ],
    tone: 'Cálido, claro y breve.',
  },
  {
    key: 'service',
    label: 'Servicios',
    organizationType: 'Servicios',
    industry: 'Servicios',
    objective: 'Informar servicios, alcance, valores oficiales, horarios, cobertura y contacto.',
    allowedTopics: [
      'Servicios',
      'Alcance',
      'Valores',
      'Horarios',
      'Cobertura',
      'Contacto',
      'Preguntas frecuentes',
    ],
    excludedTopics: [
      'Confirmar contrataciones',
      'Realizar cobros',
      'Asesoría no contratada',
      'Acciones administrativas',
    ],
    tone: 'Profesional, cercano y breve.',
  },
  {
    key: 'empty',
    label: 'Perfil vacío',
    organizationType: 'Otro',
    industry: 'Por definir',
    objective: 'Entregar únicamente información oficial configurada por la administración.',
    allowedTopics: ['Información oficial'],
    excludedTopics: ['Acciones administrativas', 'Datos personales', 'Información no confirmada'],
    tone: 'Claro y breve.',
  },
];

export function applyProfilePreset(
  current: AssistantProfile,
  key: ProfilePresetKey,
): AssistantProfile {
  const preset = requirePreset(key);
  return {
    ...current,
    organizationType: preset.organizationType,
    industry: preset.industry,
    objective: preset.objective,
    allowedTopics: [...preset.allowedTopics],
    excludedTopics: [...preset.excludedTopics],
    tone: preset.tone,
  };
}

export function createProfileFromPreset(input: {
  organizationName: string;
  botName: string;
  organizationType: OrganizationType;
  timezone: string;
  preset: ProfilePresetKey;
}): Omit<AssistantProfile, 'id' | 'active' | 'createdAt' | 'updatedAt'> {
  const preset = requirePreset(input.preset);
  return {
    internalName: input.organizationName,
    organizationName: input.organizationName,
    botName: input.botName,
    description: `Asistente de atención privada de ${input.organizationName}.`,
    organizationType: input.organizationType,
    industry: preset.industry,
    objective: preset.objective,
    allowedTopics: [...preset.allowedTopics],
    excludedTopics: [...preset.excludedTopics],
    tone: preset.tone,
    outOfScopeMessage: outOfScopeMessage(input.preset),
    noInformationMessage:
      'No tengo información confirmada sobre eso. Puedes consultar directamente con el negocio.',
    limitMessage: 'Has alcanzado el límite de consultas por ahora. Intenta más tarde.',
    aiErrorMessage: 'El asistente inteligente no está disponible en este momento.',
    medicalMessage:
      'Puedo entregar información general, pero no diagnósticos ni indicaciones de tratamiento.',
    contactInformation: '',
    businessHours: '',
    address: null,
    logoPath: null,
    primaryColor: '#176b61',
    secondaryColor: '#d8a446',
    timezone: input.timezone,
    applicationName: 'Panel del Asistente',
    headerText: input.botName,
    footerText: '',
    supportInformation: '',
  };
}

function requirePreset(key: ProfilePresetKey): ProfilePreset {
  const preset = PROFILE_PRESETS.find((item) => item.key === key);
  if (preset === undefined) throw new Error('La plantilla seleccionada no existe.');
  return preset;
}

function outOfScopeMessage(preset: ProfilePresetKey): string {
  if (preset === 'store')
    return 'Puedo ayudarte con nuestros productos, precios, horarios y servicios.';
  if (preset === 'restaurant') return 'Puedo ayudarte con el menú, precios, horarios y ubicación.';
  return 'Solo puedo responder consultas relacionadas con la información oficial de este negocio.';
}
