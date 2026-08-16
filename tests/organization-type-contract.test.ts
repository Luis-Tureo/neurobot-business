import { readFileSync } from 'node:fs';
import { ORGANIZATION_TYPES } from '../src/core/profile-presets.js';

const html = readFileSync('public/index.html', 'utf8');
const server = readFileSync('src/admin/server.ts', 'utf8');
const apiClient = readFileSync('public/js/api-client.js', 'utf8');
const schema = readFileSync('src/persistence/business-schema.ts', 'utf8');

function organizationTypeSelects(): string[] {
  return [...html.matchAll(/<select name="organizationType" required>([\s\S]*?)<\/select>/gu)].map(
    (match) => match[1] ?? '',
  );
}

function optionValues(selectHtml: string): string[] {
  return [...selectHtml.matchAll(/<option(?:\s+value="([^"]+)")?>([^<]+)<\/option>/gu)].map(
    (match) => (match[1] ?? match[2] ?? '').trim(),
  );
}

describe('contrato de tipos de negocio', () => {
  it('mantiene una lista canónica completa', () => {
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
  });

  it('todas las opciones visibles de creación y edición envían valores canónicos', () => {
    const selects = organizationTypeSelects();
    expect(selects.length).toBeGreaterThanOrEqual(2);
    for (const select of selects) {
      expect(optionValues(select)).toEqual(ORGANIZATION_TYPES);
    }
    expect(html).not.toContain('<option>Servicio profesional</option>');
    expect(html).not.toContain('value="Servicio profesional"');
  });

  it('la validación estricta del backend contiene todos los valores canónicos', () => {
    for (const type of ORGANIZATION_TYPES) {
      expect(server).toContain(`'${type}'`);
    }
    expect(server).toContain('organizationType: organizationTypeSchema');
    expect(server).not.toContain("'Servicio profesional',\n  'Otro'");
  });

  it('preserva compatibilidad con el alias legado sin ampliar el contrato del backend', () => {
    expect(schema).toContain("WHEN 'Servicio profesional' THEN 'Profesional independiente'");
    expect(apiClient).toContain("'Servicio profesional': 'Profesional independiente'");
    expect(apiClient).toContain('LEGACY_ORGANIZATION_TYPE_ALIASES');
  });

  it('mantiene un mensaje amigable y conserva el detalle técnico para diagnóstico', () => {
    expect(apiClient).toContain(
      'No se pudo guardar porque el tipo de negocio seleccionado no es válido.',
    );
    expect(apiClient).toContain('error.technicalMessage = technicalMessage');
    expect(apiClient).toContain("console.error('API validation error:', technicalMessage)");
  });
});
