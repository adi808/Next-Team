// Normalizes Israeli input (050-1234567, 0501234567, +972...) to E.164.
export function toE164(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (input.trim().startsWith('+') && digits.length >= 8) return `+${digits}`;
  if (digits.startsWith('972') && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith('0') && digits.length >= 9) return `+972${digits.slice(1)}`;
  return null;
}
