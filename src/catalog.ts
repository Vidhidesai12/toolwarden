import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ClientCapabilities } from '@modelcontextprotocol/sdk/types.js';
import type { AuditLog } from './audit.js';
import type { UpstreamConfig } from './config.js';
import type { PinStatus, PinStore, ToolDefinition } from './pins.js';

export const SEPARATOR = '__';

export interface CatalogEntry {
  key: string; // "upstream__tool", the name AI clients see
  upstream: string;
  tool: string; // the name the upstream knows
  definition: ToolDefinition;
  pin: PinStatus;
}

/** Opens an MCP client connection to one upstream, with the gateway's own token for that upstream. */
export async function connectUpstream(upstream: UpstreamConfig, capabilities: ClientCapabilities = {},
  tokenEnv: string = upstream.tokenEnv): Promise<Client> {
  const token = process.env[tokenEnv];
  if (!token) throw new Error(`environment variable ${tokenEnv} is not set`);
  const client = new Client({ name: 'toolwarden', version: '1.0.0' }, { capabilities });
  const transport = new StreamableHTTPClientTransport(new URL(upstream.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

/**
 * The tools of every upstream, with their pin status. Refreshed on a timer, so a tool whose definition
 * changes while the gateway is running is quarantined within one refresh interval.
 */
export class Catalog {
  private entries = new Map<string, CatalogEntry>();
  private readonly reachable = new Map<string, boolean>();

  constructor(private readonly upstreams: UpstreamConfig[], private readonly pins: PinStore,
              private readonly audit: AuditLog) {}

  async refresh(): Promise<void> {
    const next = new Map<string, CatalogEntry>();
    for (const upstream of this.upstreams) {
      let client: Client | undefined;
      try {
        client = await connectUpstream(upstream);
        const { tools } = await client.listTools();
        for (const tool of tools) {
          const key = upstream.name + SEPARATOR + tool.name;
          const definition: ToolDefinition = { name: tool.name, title: tool.title, description: tool.description,
            inputSchema: tool.inputSchema, annotations: tool.annotations };
          const pin = this.pins.check(key, definition);
          const before = this.entries.get(key);
          if (pin.status === 'quarantined' && before?.pin.status !== 'quarantined') {
            this.audit.write({ client: 'toolwarden', event: 'quarantine', tool: key, reason: pin.reason });
          }
          next.set(key, { key, upstream: upstream.name, tool: tool.name, definition, pin });
        }
        if (this.reachable.get(upstream.name) === false) console.log(`upstream ${upstream.name} is reachable again`);
        this.reachable.set(upstream.name, true);
      } catch (error) {
        // Keep nothing from an unreachable upstream: its tools disappear until it is back.
        // Log on the change only, so a long outage doesn't flood the log.
        if (this.reachable.get(upstream.name) !== false) {
          console.warn(`upstream ${upstream.name} unreachable at ${upstream.url}: ${error instanceof Error ? error.message : String(error)}`);
        }
        this.reachable.set(upstream.name, false);
      } finally {
        await client?.close().catch(() => undefined);
      }
    }
    this.entries = next;
  }

  get(key: string): CatalogEntry | undefined {
    return this.entries.get(key);
  }

  all(): CatalogEntry[] {
    return [...this.entries.values()];
  }

  health(): Record<string, boolean> {
    return Object.fromEntries(this.reachable);
  }
}
