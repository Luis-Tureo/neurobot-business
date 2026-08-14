import { canonicalPhoneIdentity } from '../src/messaging/identifiers.js';

describe('números de WhatsApp', () => {
  it('normaliza formatos internacionales equivalentes', () => {
    expect(canonicalPhoneIdentity('+56 9 1234 5678')).toBe('56912345678@c.us');
    expect(canonicalPhoneIdentity('56912345678@c.us')).toBe('56912345678@c.us');
    expect(canonicalPhoneIdentity('56912345678@s.whatsapp.net')).toBe('56912345678@c.us');
  });

  it('rechaza identificadores que no sean teléfonos privados válidos', () => {
    expect(canonicalPhoneIdentity('123')).toBeNull();
    expect(canonicalPhoneIdentity('cuenta@lid')).toBeNull();
    expect(canonicalPhoneIdentity('canal@newsletter')).toBeNull();
  });
});
