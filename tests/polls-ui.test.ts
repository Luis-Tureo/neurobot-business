import { readFileSync } from 'node:fs';

describe('Neurobot Business sin encuestas comunitarias', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const panel = readFileSync('public/multibot-panel.js', 'utf8');
  const server = readFileSync('src/admin/server.ts', 'utf8');
  const index = readFileSync('src/index.ts', 'utf8');

  it('no ofrece encuestas en la navegación empresarial', () => {
    expect(html).not.toContain('data-section="polls"');
    expect(html).not.toContain('Participación de la comunidad');
    expect(panel).toContain(
      "!['automatic-messages', 'polls', 'moderation', 'maintenance'].includes(module)",
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
