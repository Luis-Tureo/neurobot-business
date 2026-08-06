import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readAdminServerSource, readFriendlyPanelSource } from './source-bundles.js';

describe('Neurobot Business sin encuestas comunitarias', () => {
  const html = readFileSync(resolve('public', 'index.html'), 'utf8');
  const panel = readFileSync(resolve('public', 'multibot-panel.js'), 'utf8');
  const friendly = readFriendlyPanelSource();
  const server = readAdminServerSource();
  const index = readFileSync(resolve('src', 'index.ts'), 'utf8');

  it('no ofrece encuestas en la navegación empresarial', () => {
    expect(html).not.toContain('<option value="polls"');
    expect(friendly).not.toContain("label: 'Encuestas'");
    expect(friendly).not.toContain('Participación de la comunidad');
    expect(panel).toContain(
      "!['automatic-messages', 'polls', 'moderation'].includes(module)",
    );
  });

  it('rechaza las rutas de encuestas comunitarias', () => {
    expect(server).toContain("route.startsWith('/api/polls')");
    expect(server).toContain("code: 'BUSINESS_ONLY_ROUTE'");
  });

  it('no registra listeners de votos', () => {
    expect(index).not.toMatch(/vote_update|poll_vote|PollVote/u);
  });
});
