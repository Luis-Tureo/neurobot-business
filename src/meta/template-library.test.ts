import { describe, expect, it } from 'vitest';
import { recommendedTemplateDrafts } from './template-library.js';

describe('recommendedTemplateDrafts', () => {
  it('entrega plantillas de utilidad para empresas de reparto', () => {
    const templates = recommendedTemplateDrafts('DELIVERY');

    expect(templates.length).toBeGreaterThanOrEqual(3);
    expect(templates.every((template) => template.category === 'UTILITY')).toBe(true);
    expect(templates.map((template) => template.name)).toContain('pedido_despachado');
  });

  it('entrega plantillas de utilidad para empresas con agenda', () => {
    const templates = recommendedTemplateDrafts('APPOINTMENTS');

    expect(templates.length).toBeGreaterThanOrEqual(3);
    expect(templates.every((template) => template.category === 'UTILITY')).toBe(true);
    expect(templates.map((template) => template.name)).toContain('recordatorio_de_hora');
  });

  it('no inventa plantillas para un negocio general sin caso de uso contratado', () => {
    expect(recommendedTemplateDrafts('GENERAL')).toEqual([]);
  });

  it('devuelve copias independientes para evitar cambios accidentales en la biblioteca', () => {
    const first = recommendedTemplateDrafts('DELIVERY');
    const second = recommendedTemplateDrafts('DELIVERY');

    first[0]?.variables.push({ position: 99, label: 'Temporal', example: 'Temporal' });

    expect(second[0]?.variables.some((variable) => variable.position === 99)).toBe(false);
  });
});
