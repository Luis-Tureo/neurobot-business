const PHONE_SUFFIXES = ['@c.us', '@s.whatsapp.net'] as const;

export function canonicalPhoneIdentity(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const matchedSuffix = PHONE_SUFFIXES.find((suffix) => trimmed.endsWith(suffix));
  if (trimmed.includes('@') && matchedSuffix === undefined) return null;
  const localPart = matchedSuffix === undefined ? trimmed : trimmed.slice(0, -matchedSuffix.length);
  const digits = localPart.replace(/\D/gu, '');
  return digits.length >= 8 && digits.length <= 15 ? `${digits}@c.us` : null;
}
