import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AssistantModuleVisibilityService } from '../src/core/assistant-module-visibility-service.js';
import { createProfileFromPreset } from '../src/core/profile-presets.js';
import { AppDatabase } from '../src/persistence/database.js';

function businessProfile() {
  return createProfileFromPreset({
    organizationName: 'Negocio de prueba',
    botName: 'Asistente comercial',
    organizationType: 'Tienda',
    timezone: 'America/Santiago',
    preset: 'store',
  });
}

describe('plataforma de asistentes', () => {
  let database: AppDatabase;

  beforeEach(() => {
    database = new AppDatabase(':memory:');
    database.migrate();
  });

  afterEach(() => database.close());

  it('construye módulos distintos para comunidad, negocio y modo mixto', () => {
    const visibility = new AssistantModuleVisibilityService();
    const community = database.getBot('neurobot')!;
    expect(visibility.visibleModules(community)).not.toContain('catalog');
    expect(visibility.visibleModules(business)).toEqual(expect.arrayContaining(['menus', 'catalog', 'hours', 'requests']));
    expect(visibility.visibleModules(business)).not.toContain('polls');
  });

  it('rechaza una identidad duplicada y conserva intacto el asistente original', () => {
    const draft = database.createBot({
      id: 'borrador-duplicado', mode: 'mixed', connectorType: 'WHATSAPP_WEB',
      sessionPath: 'data/sessions/borrador-duplicado', profile: businessProfile(),
    });
    expect(original).toEqual({ accepted: true });
    expect(duplicate).toMatchObject({ accepted: false, existingBot: { id: 'neurobot' } });
    expect(database.getBot('neurobot')).toMatchObject({ lifecycleStatus: 'CONNECTED', maskedNumber: '+56••••7835' });
  });

  it('protege Neurobot y permite enviar, restaurar y conservar otro asistente', () => {
    const first = database.createBot({
      id: 'borrador-papelera', mode: 'business', sessionPath: 'data/sessions/borrador-papelera', profile: businessProfile(),
    });
    expect(() => database.sendBotToTrash('neurobot', 'actor-hash')).toThrow('PROTECTED_ASSISTANT_DELETION_BLOCKED');
    expect(database.sendBotToTrash(first.id, 'actor-hash').lifecycleStatus).toBe('ARCHIVED');
    expect(database.restoreBotFromTrash(first.id, 'actor-hash')).toMatchObject({ lifecycleStatus: 'DISABLED', enabled: false });
  });
});

describe('navegación global y por asistente', () => {
  const html = readFileSync(resolve('public', 'index.html'), 'utf8');
  const panel = readFileSync(resolve('public', 'multibot-panel.js'), 'utf8');
});
