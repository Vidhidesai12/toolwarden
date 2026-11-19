import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { canonical } from './pins.js';

/**
 * Append-only audit log in which every line carries the hash of the line before it (a hash chain).
 * Editing, deleting or reordering any past line breaks every hash after it, so tampering is detectable
 * with `verifyChain` even though the file itself is ordinary.
 */

export interface AuditEvent {
  client: string;
  event: 'call' | 'quarantine' | 'auth' | 'approve' | 'revoke';
  tool?: string;
  decision?: 'allow' | 'deny' | 'error';
  reason?: string;
  args?: unknown;
  redactions?: string[];
  durationMs?: number;
}

export interface AuditRecord extends AuditEvent {
  seq: number;
  at: string;
  prevHash: string;
  hash: string;
}

const GENESIS = '0'.repeat(64);

export class AuditLog {
  private seq = 0;
  private lastHash = GENESIS;

  constructor(private readonly file: string, private readonly now: () => Date = () => new Date()) {
    if (existsSync(file)) {
      const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
      const last = lines.at(-1);
      if (last) {
        const rec = JSON.parse(last) as AuditRecord;
        this.seq = rec.seq;
        this.lastHash = rec.hash;
      }
    }
  }

  write(event: AuditEvent): AuditRecord {
    const body = { ...event, seq: this.seq + 1, at: this.now().toISOString(), prevHash: this.lastHash };
    const hash = hashOf(body);
    const record: AuditRecord = { ...body, hash };
    appendFileSync(this.file, JSON.stringify(record) + '\n');
    this.seq = record.seq;
    this.lastHash = hash;
    return record;
  }
}

/** The newest records, newest first, for the dashboard. */
export function tail(file: string, limit: number): AuditRecord[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-limit).reverse().map((l) => JSON.parse(l) as AuditRecord);
}

function hashOf(body: Omit<AuditRecord, 'hash'>): string {
  return createHash('sha256').update(canonical(body)).digest('hex');
}

/** Returns the first broken line (1-based), or null when the whole chain is intact. */
export function verifyChain(file: string): { ok: true; lines: number } | { ok: false; line: number; reason: string } {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [];
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    const rec = JSON.parse(lines[i]!) as AuditRecord;
    const { hash, ...body } = rec;
    if (rec.prevHash !== prev) return { ok: false, line: i + 1, reason: 'previous-hash link broken' };
    if (hashOf(body) !== hash) return { ok: false, line: i + 1, reason: 'record contents changed' };
    if (rec.seq !== i + 1) return { ok: false, line: i + 1, reason: 'sequence gap' };
    prev = hash;
  }
  return { ok: true, lines: lines.length };
}
