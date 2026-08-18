import { readFileSync } from 'node:fs';
import { AssistantModuleVisibilityService } from '../src/core/assistant-module-visibility-service.js';
import { createProfileFromPreset } from '../src/core/profile-presets.js';
import { AppDatabase } from '../src/persistence/database.js';

describe('plataforma Don Gato Digital', () => {
  it('expone únicamente módulos de atención privada y gestión comercial', () => {
    const database = new AppDatabase(':memory:');
    database.migrate();
    const business = database.createBot({
      id: 'negocio-prueba',
      connectorType: 'WHATSAPP_CLOUD_API',
      profile: createProfileFromPreset({
        organizationName: 'Negocio de prueba',
        botName: 'Asistente comercial',
        organizationType: 'Comercio',
        timezone: 'America/Santiago',
        preset: 'store',
      }),
    });

    expect(new AssistantModuleVisibilityService().visibleModules(business)).toEqual([
      'overview',
      'whatsapp',
      'profile',
      'knowledge',
      'cached-answers',
      'ai',
      'statistics',
      'menus',
      'catalog',
      'media',
      'hours',
      'requests',
    ]);
    database.close();
  });

  it('mantiene el panel y su contrato orientados a negocios', () => {
    const html = readFileSync('public/index.html', 'utf8');
    const panel = readFileSync('public/multibot-panel.js', 'utf8');
    expect(html).toContain('<title>Don Gato Digital</title>');
    expect(html).toContain('data-section="test-center"');
    expect(html).toContain('data-section="history"');
    expect(html).toContain('data-organization-type-select');
    expect(panel).toContain('result.organizationTypes');
    expect(html).toContain('name="conversationHourlyLimit"');
    expect(panel).toContain("connectorType: 'WHATSAPP_CLOUD_API'");
    expect(panel).toContain('state.visibleModules = detail.visibleModules || []');
    expect(html).toContain('Meta Business Agent / Meta AI Agent — Próximamente');
  });
});
