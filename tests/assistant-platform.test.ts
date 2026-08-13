import { readFileSync } from 'node:fs';
import { AssistantModuleVisibilityService } from '../src/core/assistant-module-visibility-service.js';
import { createProfileFromPreset } from '../src/core/profile-presets.js';
import { AppDatabase } from '../src/persistence/database.js';

describe('Neurobot Business', () => {
  it('expone solamente módulos comerciales para un asistente de negocio', () => {
    const database = new AppDatabase(':memory:');
    database.migrate();
    const business = database.createBot({
      id: 'negocio-prueba',
      mode: 'business',
      connectorType: 'WHATSAPP_CLOUD_API',
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
      expect.arrayContaining(['polls', 'moderation', 'automatic-messages', 'maintenance']),
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
    const source = readFileSync('src/admin/server.ts', 'utf8');
    expect(source).toContain("route.startsWith('/api/groups')");
    expect(source).toContain("route.startsWith('/api/polls')");
    expect(source).toContain("route.includes('/moderation')");
    expect(source).toContain("code: 'BUSINESS_ONLY_ROUTE'");
  });

  it('mantiene el panel orientado al negocio', () => {
    const html = readFileSync('public/index.html', 'utf8');
    const panel = readFileSync('public/multibot-panel.js', 'utf8');
    const apiClient = readFileSync('public/js/api-client.js', 'utf8');
    expect(html).toContain('<title>Neurobot Business</title>');
    for (const group of ['Panel general', 'General', 'Negocio', 'Automatización', 'Operación']) {
      expect(html).toContain(group);
    }
    expect(html).toContain('data-section="test-center"');
    expect(html).toContain('data-section="history"');
    expect(html).not.toContain('data-section="system"');
    expect(html).not.toContain('data-section="maintenance"');
    expect(apiClient).toContain("cache: 'no-store'");
    expect(panel).toContain('groupsEnabled: false');
    expect(panel).toContain("connectorType: 'WHATSAPP_CLOUD_API'");
  });
});
