/**
 * Masks secrets and card numbers in tool results before they reach the AI client (and the audit log).
 * Defence in depth: a buggy or compromised upstream should not be able to leak them through a model.
 */

const RULES: { name: string; pattern: RegExp; replace: (m: string) => string | null }[] = [
  // Starts and ends on a digit, so the space after a card number is kept ("card 4111 ... 1111 over" stays readable).
  { name: 'card', pattern: /\b\d(?:[ -]?\d){12,18}\b/g, replace: (m) => (luhn(m.replace(/\D/g, '')) ? '[REDACTED CARD]' : null) },
  { name: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replace: () => '[REDACTED KEY]' },
  { name: 'api-key', pattern: /\b(?:sk|pk|rk)[-_](?:live|test)[-_][0-9A-Za-z]{8,}\b/g, replace: () => '[REDACTED KEY]' },
  { name: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/g, replace: () => 'Bearer [REDACTED]' },
  { name: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: () => '[REDACTED PRIVATE KEY]' },
];

export function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function redactText(text: string): { text: string; hits: string[] } {
  const hits: string[] = [];
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (m) => {
      const r = rule.replace(m);
      if (r === null) return m;
      hits.push(rule.name);
      return r;
    });
  }
  return { text: out, hits };
}

/** Redacts every string inside a JSON-like value. */
export function redactValue<T>(value: T, hits: string[] = []): T {
  if (typeof value === 'string') {
    const r = redactText(value);
    hits.push(...r.hits);
    return r.text as T;
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, hits)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, redactValue(v, hits)])) as T;
  }
  return value;
}
