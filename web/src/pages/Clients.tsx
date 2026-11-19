import { useEffect, useState } from 'react';
import { api, type CallCount, type ClientPolicy } from '../api';

export function Clients({ token, tick, onError }: { token: string; tick: number; onError: (e: unknown) => void }) {
  const [clients, setClients] = useState<ClientPolicy[] | null>(null);
  const [calls, setCalls] = useState<CallCount[]>([]);

  useEffect(() => {
    api.clients(token).then(setClients).catch(onError);
    api.calls(token).then((c) => setCalls(c.calls)).catch(onError);
  }, [token, tick, onError]);

  if (!clients) return <p className="muted">Loading…</p>;

  return (
    <>
      <header className="page-head">
        <h1>Clients</h1>
        <p>Each AI client has its own token and policy. Token hashes and upstream secrets never leave the server.</p>
      </header>
      <div className="grid-2">
        {clients.map((c) => {
          const mine = calls.filter((x) => x.client === c.name);
          const count = (d: string) => mine.filter((x) => x.decision === d).reduce((n, x) => n + x.count, 0);
          const allow = count('allow'), deny = count('deny'), error = count('error');
          const total = allow + deny + error;
          return (
            <section key={c.name} className="card">
              <h2>{c.name}</h2>
              <div className="bar" role="img" aria-label={`${allow} allowed, ${deny} blocked, ${error} errors`}>
                {total > 0 ? (
                  <>
                    <span className="bar-ok" style={{ width: `${(allow / total) * 100}%` }} />
                    <span className="bar-bad" style={{ width: `${(deny / total) * 100}%` }} />
                    <span className="bar-muted" style={{ width: `${(error / total) * 100}%` }} />
                  </>
                ) : <span className="bar-empty" />}
              </div>
              <p className="muted small">{allow} allowed · {deny} blocked · {error} {error === 1 ? 'error' : 'errors'}</p>
              <dl className="facts">
                <dt>May use</dt>
                <dd>{c.allowTools.map((p) => <code key={p}>{p}</code>)}</dd>
                {c.denyTools.length > 0 && (<><dt>Never</dt><dd>{c.denyTools.map((p) => <code key={p}>{p}</code>)}</dd></>)}
                <dt>Rate limit</dt>
                <dd>{c.callsPerMinute} calls per minute</dd>
                <dt>Limits</dt>
                <dd>{c.argumentLimits.length ? c.argumentLimits.map((l) => <span key={l.tool + l.field}><code>{l.tool}</code> {l.field} ≤ {l.max}</span>) : 'none'}</dd>
                <dt>Upstream identity</dt>
                <dd>{Object.entries(c.upstreamIdentity).map(([u, env]) => <span key={u}>{u}: <code>{env}</code></span>)}</dd>
              </dl>
              {mine.length > 0 && (
                <table className="table compact">
                  <thead><tr><th>Tool</th><th>Allowed</th><th>Blocked</th></tr></thead>
                  <tbody>
                    {[...new Set(mine.map((x) => x.tool))].sort().map((tool) => (
                      <tr key={tool}>
                        <td><code>{tool}</code></td>
                        <td>{mine.filter((x) => x.tool === tool && x.decision === 'allow').reduce((n, x) => n + x.count, 0)}</td>
                        <td>{mine.filter((x) => x.tool === tool && x.decision === 'deny').reduce((n, x) => n + x.count, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
