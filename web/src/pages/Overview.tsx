import { useEffect, useState } from 'react';
import type { Page } from '../App';
import { api, type AuditRecord, type Overview as OverviewData, type Tool, when } from '../api';

interface Props {
  token: string;
  tick: number;
  data: OverviewData | null;
  go: (p: Page) => void;
  onError: (e: unknown) => void;
}

export function Overview({ token, tick, data, go, onError }: Props) {
  const [review, setReview] = useState<Tool[]>([]);
  const [recent, setRecent] = useState<AuditRecord[]>([]);

  useEffect(() => {
    api.tools(token).then((t) => setReview(t.filter((x) => x.status === 'quarantined'))).catch(onError);
    api.audit(token, 8).then(setRecent).catch(onError);
  }, [token, tick, onError]);

  if (!data) return <p className="muted">Loading…</p>;
  const total = data.calls.allow + data.calls.deny + data.calls.error;
  const up = data.upstreams.filter((u) => u.up).length;

  return (
    <>
      <header className="page-head">
        <h1>Overview</h1>
        <p>Every AI tool call passes through ToolWarden. This page refreshes every 5 seconds.</p>
      </header>

      <section className="tiles" aria-label="Summary">
        <Tile label="MCP servers reachable" value={`${up} / ${data.upstreams.length}`} tone={up === data.upstreams.length ? 'ok' : 'bad'} />
        <Tile label="Approved tools" value={data.tools.approved} />
        <Tile label="Waiting for review" value={data.tools.quarantined} tone={data.tools.quarantined ? 'warn' : 'ok'}
          action={data.tools.quarantined ? { label: 'Review', onClick: () => go('tools') } : undefined} />
        <Tile label="Calls allowed" value={data.calls.allow} sub={total ? `${Math.round((data.calls.allow / total) * 100)}% of ${total}` : 'no calls yet'} />
        <Tile label="Calls blocked" value={data.calls.deny} tone={data.calls.deny ? 'warn' : undefined} />
        <Tile label="Secrets masked" value={data.redactions} />
        <Tile label="Audit log" value={data.audit.ok ? 'Intact' : 'Broken'} tone={data.audit.ok ? 'ok' : 'bad'}
          sub={data.audit.ok ? `${data.audit.records} records, hash chain verified` : `line ${data.audit.line}: ${data.audit.reason}`}
          action={{ label: 'Open', onClick: () => go('audit') }} />
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Needs your review</h2>
          {review.length === 0 ? (
            <p className="muted">Nothing waiting. Every tool matches the version a person approved.</p>
          ) : (
            <ul className="list">
              {review.map((t) => (
                <li key={t.key}>
                  <span className="badge warn">Quarantined</span>
                  <code>{t.key}</code>
                  <span className="muted">{t.reason}</span>
                </li>
              ))}
            </ul>
          )}
          {review.length > 0 && <button type="button" className="secondary" onClick={() => go('tools')}>Review tools</button>}
        </section>

        <section className="card">
          <h2>MCP servers</h2>
          <table className="table compact">
            <thead><tr><th>Server</th><th>Status</th><th>Tools</th></tr></thead>
            <tbody>
              {data.upstreams.map((u) => (
                <tr key={u.name}>
                  <td><strong>{u.name}</strong><div className="muted small">{u.url}</div></td>
                  <td><span className={`badge ${u.up ? 'ok' : 'bad'}`}>{u.up ? 'Reachable' : 'Unreachable'}</span></td>
                  <td>{u.tools}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card">
        <h2>Latest decisions</h2>
        <table className="table compact">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Decision</th><th>Why</th></tr></thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.seq}>
                <td className="nowrap">{when(r.at)}</td>
                <td className="nowrap">{r.client}</td>
                <td><code>{r.tool ?? r.event}</code></td>
                <td><Decision value={r.decision} event={r.event} tool={r.tool} /></td>
                <td className="muted">{r.reason ?? (r.redactions ? `masked: ${r.redactions.join(', ')}` : '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="secondary" onClick={() => go('audit')}>Full audit log</button>
      </section>
    </>
  );
}

function Tile({ label, value, sub, tone, action }: {
  label: string; value: string | number; sub?: string; tone?: 'ok' | 'warn' | 'bad';
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className={`tile ${tone ?? ''}`}>
      <span className="tile-label">{label}</span>
      <strong className="tile-value">{value}</strong>
      {sub && <span className="tile-sub">{sub}</span>}
      {action && <button type="button" className="link" onClick={action.onClick}>{action.label} →</button>}
    </div>
  );
}

export function Decision({ value, event, tool }: { value?: string; event: string; tool?: string }) {
  if (tool?.endsWith(':elicitation')) return <span className="badge info">Asked the person</span>;
  if (event === 'quarantine') return <span className="badge warn">Quarantined</span>;
  if (event === 'approve') return <span className="badge ok">Approved</span>;
  if (event === 'revoke') return <span className="badge warn">Revoked</span>;
  if (value === 'allow') return <span className="badge ok">Allowed</span>;
  if (value === 'deny') return <span className="badge bad">Blocked</span>;
  if (value === 'error') return <span className="badge muted-badge">Error</span>;
  return <span className="badge muted-badge">{event}</span>;
}
