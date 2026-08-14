import { loadEnvironment } from '../src/config/environment.js';

const valid = {
  ANONYMIZATION_SECRET: 'a'.repeat(32),
  PANEL_SESSION_SECRET: 'b'.repeat(32),
};

describe('configuración de entorno', () => {
  it('aplica valores seguros y resuelve rutas', () => {
    const environment = loadEnvironment(valid, 'C:\\proyecto');
    expect(environment.panelHost).toBe('127.0.0.1');
    expect(environment.panelPort).toBe(3001);
    expect(environment.databasePath).toContain('data');
    expect(environment.developmentMode).toBe(false);
  });

  it('convierte y valida límites configurables', () => {
    const environment = loadEnvironment({
      ...valid,
      PANEL_PORT: '4100',
      DEVELOPMENT_MODE: 'true',
    });
    expect(environment.panelPort).toBe(4100);
    expect(environment.developmentMode).toBe(true);
  });

  it('rechaza secretos cortos y puertos inseguros', () => {
    expect(() => loadEnvironment({ ...valid, ANONYMIZATION_SECRET: 'corto' })).toThrow(
      'Configuración inválida',
    );
    expect(() => loadEnvironment({ ...valid, PANEL_PORT: '80' })).toThrow('Configuración inválida');
  });

  it('trata cadenas opcionales vacías como ausentes', () => {
    const environment = loadEnvironment({
      ...valid,
      PANEL_INITIAL_PASSWORD: '',
      META_ACCESS_TOKEN: '',
    });
    expect(environment.panelInitialPassword).toBeUndefined();
    expect(environment.metaWhatsApp.accounts).toHaveLength(0);
  });

  it('exige todas las credenciales de Meta en producción', () => {
    expect(() => loadEnvironment({ ...valid, NODE_ENV: 'production' })).toThrow(
      'faltan credenciales obligatorias de Meta',
    );
    const environment = loadEnvironment({
      ...valid,
      NODE_ENV: 'production',
      META_ACCESS_TOKEN: 'token-ficticio-de-prueba-1234567890',
      META_PHONE_NUMBER_ID: '123456789012345',
      META_WABA_ID: '987654321098765',
      META_APP_SECRET: 'app-secret-ficticio-largo',
      META_WEBHOOK_VERIFY_TOKEN: 'verify-token-ficticio-largo',
    });
    expect(environment.metaWhatsApp.accounts).toEqual([
      {
        botId: 'neurobot',
        accessToken: 'token-ficticio-de-prueba-1234567890',
        phoneNumberId: '123456789012345',
        wabaId: '987654321098765',
      },
    ]);
  });

  it('valida y deduplica cuentas multibot de Meta', () => {
    const duplicate = JSON.stringify([
      {
        botId: 'negocio-uno',
        accessToken: 'token-ficticio-negocio-uno-123456',
        phoneNumberId: '123456789012345',
        wabaId: '987654321098761',
      },
      {
        botId: 'negocio-dos',
        accessToken: 'token-ficticio-negocio-dos-123456',
        phoneNumberId: '123456789012345',
        wabaId: '987654321098762',
      },
    ]);
    expect(() => loadEnvironment({ ...valid, META_WHATSAPP_ACCOUNTS_JSON: duplicate })).toThrow(
      'META_PHONE_NUMBER_ID está asignado a dos asistentes',
    );
  });
});
