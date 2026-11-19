import type { ClientPolicy } from './config.js';

export type Decision = { allowed: true } | { allowed: false; reason: string };

/** "bank__get_*" style patterns; only "*" is special. */
export function matches(pattern: string, name: string): boolean {
  const regex = new RegExp('^' + pattern.split('*').map(escapeRegex).join('.*') + '$');
  return regex.test(name);
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** Deny wins over allow; anything not explicitly allowed is denied. */
export function toolAllowed(policy: ClientPolicy, tool: string): boolean {
  if (policy.denyTools.some((p) => matches(p, tool))) return false;
  return policy.allowTools.some((p) => matches(p, tool));
}

export function checkArguments(policy: ClientPolicy, tool: string, args: Record<string, unknown>,
                               maxBytes: number): Decision {
  const size = Buffer.byteLength(JSON.stringify(args ?? {}), 'utf8');
  if (size > maxBytes) {
    return { allowed: false, reason: `arguments are ${size} bytes; the limit is ${maxBytes}` };
  }
  for (const limit of policy.argumentLimits.filter((l) => matches(l.tool, tool))) {
    const raw = args?.[limit.field];
    if (raw === undefined) continue;
    const value = typeof raw === 'number' ? raw : Number(String(raw));
    if (!Number.isFinite(value)) {
      return { allowed: false, reason: `${limit.field} must be a number` };
    }
    if (value > limit.max) {
      return { allowed: false, reason: `${limit.field} ${raw} is above this client's limit of ${limit.max}` };
    }
  }
  return { allowed: true };
}

/** Sliding one-minute window per client. In memory: one gateway instance (see README for scaling). */
export class RateLimiter {
  private readonly calls = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  take(client: string, perMinute: number): Decision {
    const t = this.now();
    const recent = (this.calls.get(client) ?? []).filter((at) => t - at < 60_000);
    if (recent.length >= perMinute) {
      this.calls.set(client, recent);
      return { allowed: false, reason: `rate limit of ${perMinute} calls per minute reached` };
    }
    recent.push(t);
    this.calls.set(client, recent);
    return { allowed: true };
  }
}
