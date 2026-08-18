export const ORGANIZATION_TYPES = [
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
] as const;

export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export type OrganizationTypeOption = Readonly<{
  value: OrganizationType;
  label: string;
}>;

const ORGANIZATION_TYPE_LABELS: Partial<Record<OrganizationType, string>> = {
  'Profesional independiente': 'Servicio profesional',
};

export const ORGANIZATION_TYPE_OPTIONS: readonly OrganizationTypeOption[] = ORGANIZATION_TYPES.map(
  (value) => ({ value, label: ORGANIZATION_TYPE_LABELS[value] ?? value }),
);

export const LEGACY_ORGANIZATION_TYPE_ALIASES = {
  Tienda: 'Comercio',
  Distribuidora: 'Comercio',
  'Servicio profesional': 'Profesional independiente',
  'Organización social': 'Servicios',
  'Institución educativa': 'Educación',
} as const satisfies Readonly<Record<string, OrganizationType>>;

const ORGANIZATION_TYPE_SET = new Set<string>(ORGANIZATION_TYPES);
const LEGACY_ORGANIZATION_TYPE_MAP: Readonly<Record<string, OrganizationType>> =
  LEGACY_ORGANIZATION_TYPE_ALIASES;

export function isOrganizationType(value: unknown): value is OrganizationType {
  return typeof value === 'string' && ORGANIZATION_TYPE_SET.has(value);
}

export function normalizeLegacyOrganizationType(value: unknown): OrganizationType | null {
  if (isOrganizationType(value)) return value;
  if (typeof value !== 'string') return null;
  return LEGACY_ORGANIZATION_TYPE_MAP[value] ?? null;
}
