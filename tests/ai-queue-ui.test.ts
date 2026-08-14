import { readFileSync } from 'node:fs';

describe('panel de capacidad de IA', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const script = readFileSync('public/multibot-panel.js', 'utf8');

  it('mantiene capacidad y métricas seguras dentro de opciones avanzadas', () => {
    for (const text of [
      'Capacidad y disponibilidad',
      'Llamadas simultáneas',
      'Solicitudes esperando',
      'Tiempo del proveedor',
      'Ventana compartida',
      'Restaurar recomendados',
    ]) {
      expect(html).toContain(text);
    }
    expect(script).toContain('/ai/queue-settings');
    expect(script).toContain('/ai/simulate-queue');
    expect(script).toContain("{ label: 'Procesándose', value: result.queue.processing }");
    expect(script).toContain("{ label: 'Esperando', value: result.queue.waiting }");
  });

  it('no muestra preguntas, respuestas, teléfonos ni claves en sus métricas', () => {
    const start = script.indexOf("renderMetricGrid('#ai-queue-cards'");
    const end = script.indexOf("document.querySelector('#ai-queue-simulator')", start);
    const metricsBlock = script.slice(start, end);
    expect(metricsBlock).not.toMatch(/question|answer|phone|apiKey|conversationId|userId/u);
  });
});
