// Trims and lowercases an email address; null when it is not one (same rule as norm_email in the database).
export function normEmail(input: string): string | null {
  const v = input.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
}
