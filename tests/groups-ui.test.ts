import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readAdminServerSource } from './source-bundles.js';

describe('Neurobot Business sin administración de grupos', () => {
  const html = readFileSync(resolve('public', 'index.html'), 'utf8');
  const panel = readFileSync(resolve('public', 'multibot-panel.js'), 'utf8');
  const server = readAdminServerSource();
  const index = readFileSync(resolve('src', 'index.ts'), 'utf8');

  it('no ofrece grupos como módulo navegable', () => {
    expect(html).not.toContain('<option value="groups"');
    expect(html).not.toContain('data-section="groups"');
    expect(panel).not.toContain("loaders.push(loadGroups())");
  });

  it('mantiene los grupos desactivados y los chats privados activos', () => {
    expect(index).toContain('groupsEnabled: false');
    expect(index).toContain('privateMessagesEnabled: true');
    expect(panel).toContain('groupsEnabled: false');
    expect(panel).toContain('privateMessagesEnabled: true');
  });

  it('rechaza las rutas de grupos en el servidor empresarial', () => {
    expect(server).toContain("route.startsWith('/api/groups')");
    expect(server).toContain("route.startsWith('/api/linked-groups')");
    expect(server).toContain("route.includes('/groups')");
    expect(server).toContain("code: 'BUSINESS_ONLY_ROUTE'");
  });
});
