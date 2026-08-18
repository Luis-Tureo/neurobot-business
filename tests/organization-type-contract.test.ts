import { readFileSync } from 'node:fs';
import {
  friendlyApiError,
  normalizeOrganizationTypePayload,
  setOrganizationTypeAliases,
} from '../public/js/api-client.js';
import {
  isOrganizationType,
  LEGACY_ORGANIZATION_TYPE_ALIASES,
  normalizeLegacyOrganizationType,
  ORGANIZATION_TYPE_OPTIONS,
  ORGANIZATION_TYPES,
} from '../src/domain/organization-types.js';

const html = readFileSync('public/index.html', 'utf8');
const client = readFileSync('public/multibot-panel.js', 'utf8');
const server = readFileSync('src/admin/server.ts', 'utf8');
const database = readFileSync('src/persistence/database.ts', 'utf8');
const schema = readFileSync('src/persistence/business-schema.ts', 'utf8');
const presets = readFileSync('src/core/profile-presets.ts', 'utf8');

describe('contrato de tipos de negocio', () => {
  it('mantiene una fuente canónica completa con etiquetas separadas de los valores', () => {
    expect(ORGANIZATION_TYPES).toEqual([
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
    ]);
    expect(ORGANIZATION_TYPE_OPTIONS.map(({ value }) => value)).toEqual(ORGANIZATION_TYPES);
    expect(ORGANIZATION_TYPE_OPTIONS).toEqual(
      expect.arrayContaining([
        { value: 'Servicios', label: 'Servicios' },
        { value: 'Profesional independiente', label: 'Servicio profesional' },
      ]),
    );
    expect(new Set(ORGANIZATION_TYPE_OPTIONS.map(({ value }) => value)).size).toBe(
      ORGANIZATION_TYPES.length,
    );
    for (const type of ORGANIZATION_TYPES) expect(isOrganizationType(type)).toBe(true);
    expect(isOrganizationType('Servicio profesional')).toBe(false);
  });

  it('creación y edición cargan sus opciones desde el contrato publicado por la API', () => {
    const selects = html.match(/<select[^>]*data-organization-type-select[^>]*>/gu) ?? [];
    expect(selects).toHaveLength(2);
    expect(selects.every((select) => select.includes('disabled'))).toBe(true);
    expect(html).not.toContain('value="Servicio profesional"');
    expect(client).toContain('result.organizationTypes');
    expect(client).toContain('select.add(new window.Option(option.label, option.value))');
    expect(client).toContain("document.querySelectorAll('[data-organization-type-select]')");
  });

  it('Zod, tipos, persistencia y SQLite derivan de la misma lista canónica', () => {
    expect(server).toContain('z.enum(ORGANIZATION_TYPES)');
    expect(database).toContain('isOrganizationType(input.organizationType)');
    expect(schema).toContain('ORGANIZATION_TYPES.map(sqlStringLiteral)');
    expect(presets).toContain(
      "export { ORGANIZATION_TYPES } from '../domain/organization-types.js'",
    );
    expect(presets).not.toContain('export const ORGANIZATION_TYPES');
  });

  it('preserva compatibilidad con valores antiguos sin ampliar el contrato del backend', () => {
    expect(normalizeLegacyOrganizationType('Servicio profesional')).toBe(
      'Profesional independiente',
    );
    expect(normalizeLegacyOrganizationType('Servicios')).toBe('Servicios');
    expect(normalizeLegacyOrganizationType('No permitido')).toBeNull();

    setOrganizationTypeAliases(LEGACY_ORGANIZATION_TYPE_ALIASES);
    const normalizedBody = normalizeOrganizationTypePayload(
      JSON.stringify({ organizationType: 'Servicio profesional' }),
    );
    expect(typeof normalizedBody).toBe('string');
    expect(JSON.parse(String(normalizedBody))).toEqual({
      organizationType: 'Profesional independiente',
    });
    expect(
      normalizeOrganizationTypePayload(JSON.stringify({ organizationType: 'Servicios' })),
    ).toBe(JSON.stringify({ organizationType: 'Servicios' }));
  });

  it('transforma el error técnico de validación en un mensaje amigable', () => {
    expect(
      friendlyApiError(
        {
          error: '[{"code":"invalid_value","path":["organizationType"]}]',
          code: 'INVALID_ORGANIZATION_TYPE',
        },
        { status: 400 },
      ),
    ).toEqual({
      technicalMessage: '[{"code":"invalid_value","path":["organizationType"]}]',
      message: 'No se pudo guardar porque el tipo de negocio seleccionado no es válido.',
    });
  });
});
