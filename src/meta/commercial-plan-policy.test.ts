import { describe, expect, it } from 'vitest';
import {
  CommercialMessagingPolicy,
  MessagingPolicyError,
  type CommercialPlan,
  type MessagingPolicyErrorCode,
} from './commercial-plan-policy.js';

describe('CommercialMessagingPolicy', () => {
  it('permite respuestas libres durante las 24 horas posteriores al mensaje del cliente', () => {
    let now = Date.UTC(2026, 7, 6, 12, 0, 0);
    const policy = new CommercialMessagingPolicy(() => 'BASIC', () => now);

    policy.recordCustomerMessage('56911111111');
    now += 23 * 60 * 60 * 1000 + 59 * 60 * 1000;

    expect(policy.isServiceWindowOpen('56911111111')).toBe(true);
    expect(() => policy.assertFreeFormMessageAllowed('56911111111')).not.toThrow();
  });

  it('bloquea mensajes libres al cumplirse las 24 horas', () => {
    let now = Date.UTC(2026, 7, 6, 12, 0, 0);
    const policy = new CommercialMessagingPolicy(() => 'BASIC', () => now);

    policy.recordCustomerMessage('56911111111');
    now += 24 * 60 * 60 * 1000;

    expect(policy.isServiceWindowOpen('56911111111')).toBe(false);
    expectPolicyError(
      () => policy.assertFreeFormMessageAllowed('56911111111'),
      'META_SERVICE_WINDOW_CLOSED',
    );
  });

  it('reinicia la ventana cuando el cliente vuelve a escribir', () => {
    let now = Date.UTC(2026, 7, 6, 12, 0, 0);
    const policy = new CommercialMessagingPolicy(() => 'BASIC', () => now);

    policy.recordCustomerMessage('56911111111');
    now += 30 * 60 * 60 * 1000;
    expect(policy.isServiceWindowOpen('56911111111')).toBe(false);

    policy.recordCustomerMessage('56911111111');
    expect(policy.isServiceWindowOpen('56911111111')).toBe(true);
  });

  it('impide usar plantillas en el plan básico aunque estén aprobadas', () => {
    const policy = new CommercialMessagingPolicy(() => 'BASIC');

    expectPolicyError(
      () => policy.assertTemplateMessageAllowed('APPROVED'),
      'ADVANCED_PLAN_REQUIRED',
    );
  });

  it('permite plantillas aprobadas únicamente en el plan avanzado', () => {
    const plan: CommercialPlan = 'ADVANCED';
    const policy = new CommercialMessagingPolicy(() => plan);

    expect(() => policy.assertTemplateMessageAllowed('APPROVED')).not.toThrow();
    expectPolicyError(
      () => policy.assertTemplateMessageAllowed('PENDING'),
      'META_TEMPLATE_NOT_APPROVED',
    );
  });

  it('expone errores reconocibles para que el panel informe el bloqueo', () => {
    const policy = new CommercialMessagingPolicy(() => 'BASIC');

    expectPolicyError(
      () => policy.assertFreeFormMessageAllowed('56911111111'),
      'META_SERVICE_WINDOW_CLOSED',
    );
  });
});

function expectPolicyError(action: () => void, expectedCode: MessagingPolicyErrorCode): void {
  try {
    action();
    throw new Error('La política debía bloquear la operación.');
  } catch (error) {
    expect(error).toBeInstanceOf(MessagingPolicyError);
    expect((error as MessagingPolicyError).code).toBe(expectedCode);
  }
}
