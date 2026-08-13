import { readFileSync } from 'node:fs';

describe('inicio empresarial consolidado', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');
  const multibot = readFileSync('public/multibot-panel.js', 'utf8');

  it('responde al estado operativo con acciones y actividad reciente', () => {
    expect(html).toContain('<h2 id="status-title">Inicio</h2>');
    expect(html).toContain('id="status-cards"');
    expect(html).toContain('id="status-quick-actions"');
    expect(html).toContain('id="overview-activity"');
    expect(html).toContain('id="attention-panel"');
    for (const label of [
      'Asistente',
      'WhatsApp',
      'Inteligencia artificial',
      'Solicitudes humanas',
    ]) {
      expect(multibot).toContain(`label: '${label}'`);
    }
  });

  it('mantiene la configuración avanzada fuera del Inicio', () => {
    const start = html.indexOf('id="section-status"');
    const end = html.indexOf('id="section-whatsapp"');
    const statusSection = html.slice(start, end);
    expect(statusSection).not.toContain('bot-configuration-form');
    expect(statusSection).not.toContain('Funcionamiento avanzado');
    expect(html.indexOf('id="bot-configuration-form"')).toBeGreaterThan(
      html.indexOf('id="section-profile"'),
    );
  });

  it('no carga módulos comunitarios al seleccionar un negocio', () => {
    expect(multibot).toContain(
      "!['automatic-messages', 'polls', 'moderation', 'maintenance'].includes(module)",
    );
    expect(multibot).not.toContain('loaders.push(loadModeration())');
  });

  it('mantiene una sola inicialización del controlador', () => {
    expect(app).toContain('assistantPanel.initialize({ force: true })');
    expect(multibot).toContain('let initializationPromise = null');
    expect(multibot).toContain('if (initializationPromise) return initializationPromise');
    expect(multibot).toContain('if (configured) return');
  });
});
