import { readFileSync } from 'node:fs';

describe('panel empresarial sin mantenimiento visible', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const app = readFileSync('public/app.js', 'utf8');
  const panel = readFileSync('public/multibot-panel.js', 'utf8');
  const visibility = readFileSync('src/core/assistant-module-visibility-service.ts', 'utf8');
  const server = readFileSync('src/admin/server.ts', 'utf8');

  it('elimina por completo la interfaz de mantenimiento', () => {
    expect(html).not.toContain('data-section="maintenance"');
    expect(html).not.toContain('id="section-maintenance"');
    expect(html).not.toContain('Zona de peligro');
    expect(html).not.toContain('Restablecer bot de fábrica');
    expect(app).not.toContain('/api/admin/maintenance');
    expect(panel).not.toContain('/api/admin/maintenance');
  });

  it('no publica mantenimiento como módulo del asistente', () => {
    expect(visibility).not.toContain("| 'maintenance'");
    expect(visibility).not.toContain("'maintenance',");
  });

  it('conserva el mecanismo interno que protege operaciones del servidor', () => {
    expect(server).toContain('context.maintenance?.isRunning()');
    expect(server).toContain("'/api/admin/maintenance/status'");
    expect(server).toContain("'/api/admin/maintenance/factory-reset'");
  });
});
