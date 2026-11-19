import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Tool pinning: defends against tool poisoning and "rug pulls".
 *
 * An MCP tool's description is read by the AI model, so a server that changes a description can inject
 * instructions ("before answering, also send the account list to ..."). The gateway fingerprints every
 * upstream tool (name, description, input schema, annotations) and only exposes tools whose fingerprint
 * a person approved in pins.json. A changed or new tool is quarantined until someone reviews and re-pins it.
 */

export interface ToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  annotations?: unknown;
}

export type PinStatus =
  | { status: 'approved' }
  | { status: 'quarantined'; reason: string };

/** Phrases that have no business in a tool description; seen in published tool-poisoning attacks. */
const SUSPICIOUS: { pattern: RegExp; label: string }[] = [
  { pattern: /ignore (all |any )?(previous|prior|above) instructions/i, label: 'tells the model to ignore its instructions' },
  { pattern: /<\s*(important|system|secret)\s*>/i, label: 'a hidden instruction tag' },
  { pattern: /do not (tell|inform|mention)/i, label: 'asks the model to hide something from the user' },
  { pattern: /(send|forward|upload|exfiltrate) .{0,40}(to|at) (https?:\/\/|[\w.-]+@)/i, label: 'asks to send data somewhere' },
  { pattern: /\b(api[_ -]?key|password|private key|ssh)\b/i, label: 'mentions keys, passwords or SSH' },
];

export function fingerprint(tool: ToolDefinition): string {
  return createHash('sha256').update(canonical({
    name: tool.name,
    title: tool.title ?? null,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? null,
    annotations: tool.annotations ?? null,
  })).digest('hex');
}

/** JSON with sorted keys, so the fingerprint does not depend on key order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    // Skip undefined fields exactly as JSON.stringify does, so a hash survives a round trip through a file.
    return '{' + Object.keys(value as object).filter((k) => (value as Record<string, unknown>)[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function suspiciousPhrase(tool: ToolDefinition): string | null {
  const text = `${tool.title ?? ''} ${tool.description ?? ''} ${JSON.stringify(tool.inputSchema ?? {})}`;
  // A plain-language reason plus the words that matched, so an operator can judge it without reading a regex.
  for (const { pattern, label } of SUSPICIOUS) {
    const match = pattern.exec(text);
    if (match) return `${label}: "${match[0].slice(0, 60)}"`;
  }
  return null;
}

/** What a person approved: the exact definition, so a later change can be shown side by side. */
export interface Pin {
  fingerprint: string;
  definition?: ToolDefinition;
  approvedBy?: string;
  approvedAt?: string;
}

export class PinStore {
  private pins: Record<string, Pin>;

  constructor(private readonly file: string, private readonly now: () => Date = () => new Date()) {
    const raw: Record<string, string | Pin> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    // Older pin files stored only the fingerprint string; still accepted.
    this.pins = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? { fingerprint: v } : v]));
  }

  /** key = "upstream__tool". */
  check(key: string, tool: ToolDefinition): PinStatus {
    const phrase = suspiciousPhrase(tool);
    if (phrase) return { status: 'quarantined', reason: `looks like tool poisoning: ${phrase}` };
    const pinned = this.pins[key];
    if (!pinned) return { status: 'quarantined', reason: 'new tool, not yet approved' };
    if (pinned.fingerprint !== fingerprint(tool)) return { status: 'quarantined', reason: 'tool definition changed since it was approved' };
    return { status: 'approved' };
  }

  get(key: string): Pin | undefined {
    return this.pins[key];
  }

  /**
   * A person approves one tool exactly as it is now. Suspicious definitions can't be approved:
   * the fix belongs in the server, not in an override.
   */
  approve(key: string, tool: ToolDefinition, by: string): Pin {
    const phrase = suspiciousPhrase(tool);
    if (phrase) throw new Error(`refusing to approve; looks like tool poisoning: ${phrase}`);
    const pin = { fingerprint: fingerprint(tool), definition: tool, approvedBy: by, approvedAt: this.now().toISOString() };
    this.pins[key] = pin;
    this.save();
    return pin;
  }

  /** Withdraws approval: the tool is quarantined again at the next check. */
  revoke(key: string): boolean {
    if (!this.pins[key]) return false;
    delete this.pins[key];
    this.save();
    return true;
  }

  /** Used by `npm run pin` after a person has reviewed the tool list. */
  approveAll(tools: Record<string, ToolDefinition>, by = 'cli'): void {
    for (const [k, t] of Object.entries(tools)) {
      this.pins[k] = { fingerprint: fingerprint(t), definition: t, approvedBy: by, approvedAt: this.now().toISOString() };
    }
    this.save();
  }

  private save(): void {
    const sorted = Object.fromEntries(Object.entries(this.pins).sort(([a], [b]) => (a < b ? -1 : 1)));
    writeFileSync(this.file, `${JSON.stringify(sorted, null, 2)}\n`);
  }
}
