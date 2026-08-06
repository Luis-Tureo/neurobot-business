import { describe, expect, it } from 'vitest';
import {
  CommercialMessagingPolicy,
  MessagingPolicyError,
  type CommercialPlan,
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
    expect(() => policy.assertFreeFormMessageAllowed('56911111111')).toThrowError(
      expect.objectContaining({ code: 'META_SERVICE_WINDOW_CLOSED' }),
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

    expect(() => policy.assertTemplateMessageAllowed('APPROVED')).toThrowError(
      expect.objectContaining({ code: 'ADVANCED_PLAN_REQUIRED' }),
    );
  });

  it('permite plantillas aprobadas únicamente en el plan avanzado', () => {
    const plan: CommercialPlan = 'ADVANCED';
    const policy = new CommercialMessagingPolicy(() => plan);

    expect(() => policy.assertTemplateMessageAllowed('APPROVED')).not.toThrow();
    expect(() => policy.assertTemplateMessageAllowed('PENDING')).toThrowError(
      expect.objectContaining({ code: 'META_TEMPLATE_NOT_APPROVED' }),
    );
  });

  it('expone errores reconocibles para que el panel informe el bloqueo', () => {
    const policy = new CommercialMessagingPolicy(() => 'BASIC');

    try {
      policy.assertFreeFormMessageAllowed('56911111111');
      throw new Error('La política debía bloquear el mensaje.');
    } catch (error) {
      expect(error).toBeInstanceOf(MessagingPolicyError);
      expect((error as MessagingPolicyError).code).toBe('META_SERVICE_WINDOW_CLOSED');
    }
  });
});
