import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');
const css = readFileSync('src/admin/panel.css', 'utf8');

describe('módulo simplificado de inteligencia artificial', () => {
  it('muestra primero estado y opciones principales', () => {
    expect(html).toContain('<h2 id="ai-title">Inteligencia artificial</h2>');
    expect(html).toContain('<h3>Opciones principales</h3>');
    expect(html.indexOf('Opciones principales')).toBeLessThan(html.indexOf('Opciones avanzadas'));
    for (const id of [
      'ai-status-cards',
      'ai-settings-form',
      'ai-queue-settings-form',
      'ai-queue-simulator',
      'global-ai-limits-form',
      'test-ai-connection',
      'reset-ai-counters',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('Credencial administrada por Don Gato Digital');
    expect(html).not.toContain('id="ai-credential-form"');
    expect(html).toContain('data-ai-model-select');
  });

  it('mantiene cerradas por defecto las opciones técnicas', () => {
    const advanced = html.slice(html.indexOf('Opciones avanzadas'));
    expect(advanced).toContain('Modelo, procesamiento, límites técnicos y presupuesto.');
    expect(html).toContain('Capacidad y disponibilidad');
    expect(html).toContain('Restaurar recomendados');
    expect(html).not.toMatch(/<details[^>]*\sopen(?:\s|>)/gu);
  });

  it('usa componentes ordenados y adaptables', () => {
    expect(css).toContain('.health-grid');
    expect(css).toContain('.disclosure');
    expect(css).toContain('.form-grid');
    expect(css).toContain('@media (max-width: 700px)');
  });
});
