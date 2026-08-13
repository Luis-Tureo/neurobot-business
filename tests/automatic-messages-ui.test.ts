import { readFileSync } from 'node:fs';

describe('Neurobot Business sin automatizaciones comunitarias', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const panel = readFileSync('public/multibot-panel.js', 'utf8');
  const server = readFileSync('src/admin/server.ts', 'utf8');

  it('no ofrece mensajes automáticos de grupos como si fueran compatibles', () => {
    expect(html).not.toContain('data-section="automatic-messages"');
    expect(html).not.toContain('id="section-automatic-messages"');
    expect(panel).toContain(
      "!['automatic-messages', 'polls', 'moderation', 'maintenance'].includes(module)",
    );
    expect(panel).not.toContain("api('/api/automatic-messages'");
  });

  it('rechaza las rutas comunitarias en el servidor', () => {
    expect(server).toContain("route.startsWith('/api/automatic-messages')");
    expect(server).toContain("code: 'BUSINESS_ONLY_ROUTE'");
    expect(server).toContain('Esta función no forma parte de Neurobot Business.');
  });
});
