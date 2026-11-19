// Typed calls to ToolWarden's admin API. The admin token lives only in this browser tab's session storage.

export interface Overview {
  upstreams: { name: string; up: boolean; url?: string; tools: number }[];
  tools: { approved: number; quarantined: number };
  calls: { allow: number; deny: number; error: number };
  redactions: number;
  clients: number;
  audit: { ok: true; records: number } | { ok: false; line: number; reason: string };
}

export interface Tool {
  key: string;
  upstream: string;
  tool: string;
  status: 'approved' | 'quarantined';
  reason?: string;
  suspicious: boolean;
  description: string;
  readOnly: boolean;
  fingerprint: string;
  approved?: { fingerprint: string; description?: string; by?: string; at?: string };
}

export interface ClientPolicy {
  name: string;
  allowTools: string[];
  denyTools: string[];
  callsPerMinute: number;
  argumentLimits: { tool: string; field: string; max: number }[];
  upstreamIdentity: Record<string, string>;
}

export interface CallCount {
  client: string;
  tool: string;
  decision: string;
  count: number;
}

export interface AuditRecord {
  seq: number;
  at: string;
  client: string;
  event: string;
  tool?: string;
  decision?: string;
  reason?: string;
  redactions?: string[];
  durationMs?: number;
  hash: string;
  prevHash: string;
}

export type ChainResult = { ok: true; lines: number } | { ok: false; line: number; reason: string };

const KEY = 'toolwarden-admin-token';

export function savedToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the token just isn't remembered for this tab.
  }
}

export class Unauthorized extends Error {}

async function call<T>(token: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method: init?.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401) throw new Unauthorized('The admin token was not accepted.');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  overview: (t: string) => call<Overview>(t, '/overview'),
  tools: (t: string) => call<Tool[]>(t, '/tools'),
  approve: (t: string, key: string, fingerprint: string) =>
    call<{ ok: boolean; status: string }>(t, `/tools/${encodeURIComponent(key)}/approve`, { method: 'POST', body: { fingerprint } }),
  revoke: (t: string, key: string) => call<{ ok: boolean }>(t, `/tools/${encodeURIComponent(key)}/revoke`, { method: 'POST', body: {} }),
  clients: (t: string) => call<ClientPolicy[]>(t, '/clients'),
  calls: (t: string) => call<{ calls: CallCount[]; redactions: number }>(t, '/calls'),
  audit: (t: string, limit = 200) => call<AuditRecord[]>(t, `/audit?limit=${limit}`),
  verify: (t: string) => call<ChainResult>(t, '/audit/verify', { method: 'POST', body: {} }),
  refresh: (t: string) => call<{ ok: boolean }>(t, '/refresh', { method: 'POST', body: {} }),
};

export const short = (hash: string, n = 12) => hash.slice(0, n);

export function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
