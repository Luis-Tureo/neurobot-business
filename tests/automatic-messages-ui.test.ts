import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Neurobot Business sin automatizaciones comunitarias', () => {
  const html = readFileSync(resolve('public', 'index.html'), 'utf8');
  const panel = readFileSync(resolve('public', 'multibot-panel.js'), 'utf8');
  const friendly = readFileSync(resolve('public', 'friendly-panel.js'), 'utf8');
  const server = readFileSync(resolve('src', 'admin', 'server.ts'), 'utf8');

  it('no ofrece mensajes automáticos para grupos en la navegación empresarial', () => {
    expect(html).not.toContain('<option value="automatic-messages"');
    expect(friendly).not.toContain("label: 'Mensajes automáticos'");
    expect(friendly).not.toContain("id: 'community'");
    expect(panel).toContain(
      "!['automatic-messages', 'polls', 'moderation'].includes(module)",
    );
  });

  it('rechaza las rutas de automatización comunitaria en el servidor', () => {
    expect(server).toContain("route.startsWith('/api/automatic-messages')");
    expect(server).toContain("code: 'BUSINESS_ONLY_ROUTE'");
    expect(server).toContain('Esta función no forma parte de Neurobot Business.');
  });
});
