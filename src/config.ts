import { readFileSync } from 'node:fs';

/** One MCP server behind the gateway. Its token comes from an environment variable, never from a client. */
export interface UpstreamConfig {
  name: string;
  url: string;
  tokenEnv: string;
}

/** A numeric argument limit, e.g. bank__transfer.amount <= 250. */
export interface ArgumentLimit {
  tool: string;
  field: string;
  max: number;
}

/** What one AI client may do through the gateway. Tool patterns are namespaced, e.g. "bank__get_*". */
export interface ClientPolicy {
  name: string;
  tokenSha256: string;
  allowTools: string[];
  denyTools: string[];
  callsPerMinute: number;
  argumentLimits: ArgumentLimit[];
  /**
   * Which upstream identity this client's calls use, as upstream name -> environment variable.
   * Defaults to the upstream's own tokenEnv (its least-privileged token), so the gateway never turns
   * a read-only client into an operator upstream (no confused deputy).
   */
  upstreamTokenEnv?: Record<string, string>;
}

export interface GatewayConfig {
  port: number;
  allowedHosts: string[];
  allowedOrigins: string[];
  upstreams: UpstreamConfig[];
  clients: ClientPolicy[];
  pinsFile: string;
  auditFile: string;
  maxArgumentBytes: number;
  catalogRefreshSeconds: number;
  /**
   * SHA-256 of the dashboard's admin token. Absent = no admin API and no dashboard. The admin token is
   * separate from every AI client token: an AI client can never approve its own tools.
   */
  adminTokenSha256?: string;
}

export function loadConfig(path: string): GatewayConfig {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as GatewayConfig;
  const env = process.env;
  return {
    ...raw,
    port: Number(env.PORT ?? raw.port),
    allowedHosts: env.ALLOWED_HOSTS ? env.ALLOWED_HOSTS.split(',') : raw.allowedHosts,
    upstreams: raw.upstreams.map((u) => ({ ...u, url: env[`UPSTREAM_${u.name.toUpperCase()}_URL`] ?? u.url })),
    pinsFile: env.PINS_FILE ?? raw.pinsFile,
    auditFile: env.AUDIT_FILE ?? raw.auditFile,
    catalogRefreshSeconds: Number(env.CATALOG_REFRESH_SECONDS ?? raw.catalogRefreshSeconds),
    adminTokenSha256: env.ADMIN_TOKEN_SHA256 ?? raw.adminTokenSha256,
  };
}
