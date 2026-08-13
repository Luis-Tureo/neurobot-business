import { readFileSync } from 'node:fs';

describe('Neurobot Business sin moderación comunitaria', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const panel = readFileSync('public/multibot-panel.js', 'utf8');
  const server = readFileSync('src/admin/server.ts', 'utf8');

  it('no ofrece moderación en la navegación empresarial', () => {
    expect(html).not.toContain('data-section="moderation"');
    expect(html).not.toContain('Participación de la comunidad');
  });

  it('no carga manejadores de moderación desde el panel empresarial', () => {
    expect(panel).not.toContain('loaders.push(loadModeration())');
    expect(panel).not.toContain('async function renderSimpleModeration');
    expect(panel).not.toContain('bindSimpleModeration()');
  });

  it('bloquea las rutas de moderación en el servidor', () => {
    expect(server).toContain("route.includes('/moderation')");
    expect(server).toContain("code: 'BUSINESS_ONLY_ROUTE'");
  });
});
