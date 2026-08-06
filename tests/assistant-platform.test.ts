import { readFileSync } from 'node:fs';
import { AssistantModuleVisibilityService } from '../src/core/assistant-module-visibility-service.js';
import { createProfileFromPreset } from '../src/core/profile-presets.js';
import { AppDatabase } from '../src/persistence/database.js';
import { readAdminServerSource } from './source-bundles.js';

describe('Neurobot Business', () => {
  it('expone solamente módulos comerciales para un asistente de negocio', () => {
    const database = new AppDatabase(':memory:');
    database.migrate();
    const business = database.createBot({
      id: 'negocio-prueba',
      mode: 'business',
      connectorType: 'WHATSAPP_WEB',
      sessionPath: 'data/sessions/negocio-prueba',
      profile: createProfileFromPreset({
        organizationName: 'Negocio de prueba',
        botName: 'Asistente comercial',
        organizationType: 'Tienda',
        timezone: 'America/Santiago',
        preset: 'store',
      }),
    });
    const modules = new AssistantModuleVisibilityService().visibleModules(business);
    expect(modules).toEqual(expect.arrayContaining(['menus', 'catalog', 'hours', 'requests']));
    expect(modules).not.toEqual(
      expect.arrayContaining(['polls', 'moderation', 'automatic-messages']),
    );
    database.close();
  });

  it('normaliza cada instancia a chats privados al iniciar', () => {
    const source = readFileSync('src/index.ts', 'utf8');
    expect(source).toContain("mode: 'business'");
    expect(source).toContain('groupsEnabled: false');
    expect(source).toContain('privateMessagesEnabled: true');
    expect(source).toContain('businessOnly: true');
  });

  it('bloquea rutas de comunidad desde el servidor empresarial', () => {
    const source = readAdminServerSource();
    expect(source).toContain("route.startsWith('/api/groups')");
    expect(source).toContain("route.startsWith('/api/polls')");
    expect(source).toContain("route.includes('/moderation')");
    expect(source).toContain("code: 'BUSINESS_ONLY_ROUTE'");
  });

  it('mantiene el panel orientado al negocio', () => {
    const html = readFileSync('public/index.html', 'utf8');
    const panel = readFileSync('public/multibot-panel.js', 'utf8');
    expect(html).toContain('<title>Neurobot Business</title>');
    expect(html).toContain('<summary>Información del negocio</summary>');
    expect(html).toContain('<summary>Atención automática</summary>');
    expect(html).toContain('<summary>Atención humana</summary>');
    expect(html).not.toContain('<option value="polls"');
    expect(html).not.toContain('<option value="moderation"');
    expect(panel).toContain("cache: 'no-store'");
    expect(panel).toContain('groupsEnabled: false');
    expect(panel).not.toContain("node('p', bot.organizationName || 'Sin organización', 'bot-org')");
  });
});
