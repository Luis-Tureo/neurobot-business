import { ConnectionManager } from '../src/core/connection-manager.js';
import { createLogger } from '../src/infrastructure/logger.js';
import { SimulatedMessagingClient } from '../src/messaging/simulated-client.js';

describe('máquina de conexión y reconexión', () => {
  it('impide inicializaciones simultáneas', async () => {
    const client = new SimulatedMessagingClient();
    await Promise.all([manager.start(), manager.start()]);
    expect(client.initializeCalls).toBe(1);
  });

  it('refleja conexión, error de autenticación y cierre', async () => {
    const client = new SimulatedMessagingClient();
    const manager = new ConnectionManager(client, createLogger('silent'), {
      maxAttempts: 3,
      maxDelayMs: 100,
    });
    manager.updateState('connected');
    manager.updateState('auth_failure', 'sesión inválida');
    expect(manager.snapshot().state).toBe('auth_failure');
    expect(manager.snapshot().lastErrorCode).toBe('AUTH_FAILURE');
    await manager.stop();
    expect(client.destroyCalls).toBe(1);
  });

  it('reinicia de forma controlada', async () => {
    const client = new SimulatedMessagingClient();
    const manager = new ConnectionManager(client, createLogger('silent'), {
      maxAttempts: 3,
      maxDelayMs: 100,
    });
    expect(client.destroyCalls).toBe(1);
    expect(client.initializeCalls).toBe(1);
  });

  it('combina reinicios simultáneos en una sola operación', async () => {
    const manager = new ConnectionManager(client, createLogger('silent'), {
      maxAttempts: 3,
      maxDelayMs: 100,
    });
    expect(client.destroyCalls).toBe(1);
  });
});
