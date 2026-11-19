import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ElicitRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AuditLog } from './audit.js';
import { type Catalog, connectUpstream } from './catalog.js';
import type { ClientPolicy, GatewayConfig } from './config.js';
import type { Metrics } from './metrics.js';
import type { PinStore } from './pins.js';
import { checkArguments, type RateLimiter, toolAllowed } from './policy.js';
import { redactValue } from './redact.js';

export interface GatewayDeps {
  config: GatewayConfig;
  catalog: Catalog;
  audit: AuditLog;
  limiter: RateLimiter;
  metrics: Metrics;
  pins: PinStore;
}

/**
 * One gateway session per AI client connection. The gateway is an MCP server to the client and an
 * MCP client to each upstream. Upstream connections are opened per session, so a confirmation request
 * (elicitation) from an upstream is relayed to the right person's client.
 */
export function createSession(policy: ClientPolicy, deps: GatewayDeps): { server: Server; close: () => Promise<void> } {
  const server = new Server(
    { name: 'toolwarden', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions: 'Tools from several MCP servers, through the ToolWarden security gateway. Each tool name is '
        + 'prefixed with the server it comes from (for example bank__get_balance). Calls are checked against '
        + 'your client policy and audited.',
    },
  );
  const upstreamClients = new Map<string, Promise<Client>>();

  function upstreamClient(name: string): Promise<Client> {
    let client = upstreamClients.get(name);
    if (!client) {
      const upstream = deps.config.upstreams.find((u) => u.name === name);
      if (!upstream) throw new Error(`unknown upstream ${name}`);
      // Advertise elicitation upstream only if this person's client can actually show the question.
      const canAsk = server.getClientCapabilities()?.elicitation !== undefined;
      const tokenEnv = policy.upstreamTokenEnv?.[name] ?? upstream.tokenEnv;
      client = connectUpstream(upstream, canAsk ? { elicitation: { form: {} } } : {}, tokenEnv).then((c) => {
        if (canAsk) {
          c.setRequestHandler(ElicitRequestSchema, async (request) => {
            deps.audit.write({ client: policy.name, event: 'call', tool: `${name}:elicitation`, decision: 'allow',
              reason: 'relayed confirmation request to the person' });
            return server.elicitInput(request.params);
          });
        }
        return c;
      });
      client.catch(() => upstreamClients.delete(name));
      upstreamClients.set(name, client);
    }
    return client;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: deps.catalog.all()
      .filter((e) => e.pin.status === 'approved' && toolAllowed(policy, e.key))
      .map((e) => ({
        name: e.key,
        title: e.definition.title,
        description: e.definition.description,
        inputSchema: e.definition.inputSchema as { type: 'object'; [k: string]: unknown },
        annotations: e.definition.annotations as Record<string, unknown> | undefined,
      })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const started = Date.now();
    const key = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const deny = (reason: string): CallToolResult => {
      deps.audit.write({ client: policy.name, event: 'call', tool: key, decision: 'deny', reason,
        args: redactValue(args), durationMs: Date.now() - started });
      deps.metrics.count(policy.name, key, 'deny');
      return { isError: true, content: [{ type: 'text', text: `Blocked by ToolWarden: ${reason}` }] };
    };

    const entry = deps.catalog.get(key);
    if (!entry) return deny('unknown tool');
    if (entry.pin.status === 'quarantined') return deny(`tool is quarantined: ${entry.pin.reason}`);
    if (!toolAllowed(policy, key)) return deny('this client is not allowed to use this tool');
    const rate = deps.limiter.take(policy.name, policy.callsPerMinute);
    if (!rate.allowed) return deny(rate.reason);
    const argCheck = checkArguments(policy, key, args, deps.config.maxArgumentBytes);
    if (!argCheck.allowed) return deny(argCheck.reason);

    try {
      const client = await upstreamClient(entry.upstream);
      const result = (await client.callTool({ name: entry.tool, arguments: args })) as CallToolResult;
      const hits: string[] = [];
      const safe = redactValue(result, hits);
      deps.audit.write({ client: policy.name, event: 'call', tool: key, decision: safe.isError ? 'error' : 'allow',
        reason: safe.isError ? 'the server answered with an error (for example, the person declined)' : undefined,
        args: redactValue(args), redactions: hits.length ? hits : undefined, durationMs: Date.now() - started });
      deps.metrics.count(policy.name, key, safe.isError ? 'error' : 'allow');
      if (hits.length) deps.metrics.redactions(hits.length);
      return safe;
    } catch {
      deps.audit.write({ client: policy.name, event: 'call', tool: key, decision: 'error',
        reason: 'upstream unavailable', args: redactValue(args), durationMs: Date.now() - started });
      deps.metrics.count(policy.name, key, 'error');
      return { isError: true, content: [{ type: 'text', text: `The ${entry.upstream} server is unavailable; try again later` }] };
    }
  });

  return {
    server,
    close: async () => {
      for (const c of upstreamClients.values()) await c.then((x) => x.close()).catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}
