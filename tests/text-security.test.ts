import { Anonymizer } from '../src/security/anonymizer.js';
import { hashPassword, verifyPassword } from '../src/security/password.js';
import {
  assertPlainText,
  containsWholeTerm,
  maskPhoneNumber,
  normalizePhoneNumber,
  normalizeText,
} from '../src/utils/text.js';

describe('normalización y privacidad', () => {
  it('normaliza tildes, espacios y mayúsculas', () => {
    expect(normalizeText('  Información   MÉDICA ')).toBe('informacion medica');
  });

  it('evita coincidencias parciales incorrectas', () => {
    expect(containsWholeTerm('Necesito información sobre el horario.', 'horario')).toBe(true);
    expect(containsWholeTerm('Consulta los horarios disponibles.', 'horario')).toBe(false);
  });

  it('enmascara y valida números internacionales', () => {
    expect(maskPhoneNumber('+56 9 1234 5678')).toMatch(/^\*+5678$/);
    expect(normalizePhoneNumber('+56 9 1234 5678')).toBe('56912345678@c.us');
    expect(() => normalizePhoneNumber('123')).toThrow('formato internacional');
  });

  it('rechaza HTML en respuestas configurables', () => {
    expect(assertPlainText('Respuesta segura')).toBe('Respuesta segura');
    expect(() => assertPlainText('<b>texto</b>')).toThrow('texto plano');
  });

  it('anonimiza mediante HMAC estable y secreto', () => {
    const first = new Anonymizer('a'.repeat(32));
    const second = new Anonymizer('b'.repeat(32));
    expect(first.identifier('56912345678@c.us')).toBe(first.identifier('56912345678@c.us'));
    expect(first.identifier('56912345678@c.us')).not.toContain('56912345678');
    expect(first.identifier('56912345678@c.us')).not.toBe(second.identifier('56912345678@c.us'));
  });

  it('protege contraseñas con scrypt', async () => {
    const hash = await hashPassword('contraseña-muy-segura');
    expect(hash).not.toContain('contraseña-muy-segura');
    await expect(verifyPassword('contraseña-muy-segura', hash)).resolves.toBe(true);
    await expect(verifyPassword('incorrecta', hash)).resolves.toBe(false);
    await expect(hashPassword('corta')).rejects.toThrow('12');
  });
});
