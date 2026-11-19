export interface CallCount {
  client: string;
  tool: string;
  decision: string;
  count: number;
}

/** Minimal Prometheus counters, no dependency: toolwarden_tool_calls_total{client,tool,decision}. */
export class Metrics {
  private readonly calls = new Map<string, number>();
  private readonly rows = new Map<string, CallCount>();
  private redacted = 0;

  count(client: string, tool: string, decision: string): void {
    const key = `client="${esc(client)}",tool="${esc(tool)}",decision="${decision}"`;
    this.calls.set(key, (this.calls.get(key) ?? 0) + 1);
    const row = this.rows.get(key) ?? { client, tool, decision, count: 0 };
    row.count += 1;
    this.rows.set(key, row);
  }

  /** The same counters as data, for the dashboard. */
  snapshot(): { calls: CallCount[]; redactions: number } {
    return { calls: [...this.rows.values()].map((r) => ({ ...r })), redactions: this.redacted };
  }

  redactions(n: number): void {
    this.redacted += n;
  }

  render(quarantined: number): string {
    const lines = [
      '# HELP toolwarden_tool_calls_total Tool calls seen by ToolWarden, by decision',
      '# TYPE toolwarden_tool_calls_total counter',
      ...[...this.calls].map(([labels, v]) => `toolwarden_tool_calls_total{${labels}} ${v}`),
      '# HELP toolwarden_redactions_total Secrets or card numbers masked in tool results',
      '# TYPE toolwarden_redactions_total counter',
      `toolwarden_redactions_total ${this.redacted}`,
      '# HELP toolwarden_quarantined_tools Tools hidden because their definition is new, changed or suspicious',
      '# TYPE toolwarden_quarantined_tools gauge',
      `toolwarden_quarantined_tools ${quarantined}`,
    ];
    return lines.join('\n') + '\n';
  }
}

function esc(s: string): string {
  return s.replace(/["\\\n]/g, '_');
}
