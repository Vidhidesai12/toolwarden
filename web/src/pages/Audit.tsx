import { useEffect, useMemo, useState } from 'react';
import { api, type AuditRecord, type ChainResult, short, when } from '../api';
import { Decision } from './Overview';

export function Audit({ token, tick, onError }: { token: string; tick: number; onError: (e: unknown) => void }) {
  const [records, setRecords] = useState<AuditRecord[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [chain, setChain] = useState<ChainResult | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api.audit(token, 300).then(setRecords).catch(onError);
  }, [token, tick, onError]);

  const shown = useMemo(() => (records ?? []).filter((r) => {
    if (filter === 'blocked' && r.decision !== 'deny') return false;
    if (filter === 'allowed' && r.decision !== 'allow') return false;
    if (filter === 'admin' && !['approve', 'revoke', 'quarantine'].includes(r.event)) return false;
    const q = query.trim().toLowerCase();
    return !q || [r.client, r.tool, r.reason, r.event].some((v) => v?.toLowerCase().includes(q));
  }), [records, filter, query]);

  const verify = async () => {
    setChecking(true);
    try {
      setChain(await api.verify(token));
    } catch (e) {
      onError(e);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <header className="page-head">
        <h1>Audit log</h1>
        <p>Every decision, newest first. Each record carries the hash of the one before it, so editing or deleting a past record breaks the chain.</p>
      </header>
      <div className="toolbar">
        <button type="button" className="primary" onClick={verify} disabled={checking}>{checking ? 'Checking…' : 'Verify hash chain'}</button>
        {chain && (chain.ok
          ? <span className="banner ok inline" role="status">Chain intact: all {chain.lines} records verified.</span>
          : <span className="banner bad inline" role="alert">Tampering detected at record {chain.line}: {chain.reason}.</span>)}
        <span className="spacer" />
        <label className="sr-only" htmlFor="audit-filter">Show</label>
        <select id="audit-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All records</option>
          <option value="blocked">Blocked calls</option>
          <option value="allowed">Allowed calls</option>
          <option value="admin">Approvals and quarantines</option>
        </select>
        <label className="sr-only" htmlFor="audit-search">Search</label>
        <input id="audit-search" type="search" placeholder="Search client, tool, reason" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <section className="card flush">
        {!records ? <p className="muted pad">Loading…</p> : (
          <table className="table">
            <thead><tr><th>#</th><th>When</th><th>Who</th><th>What</th><th>Decision</th><th>Why</th><th>Hash</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.seq}>
                  <td className="muted">{r.seq}</td>
                  <td className="nowrap">{when(r.at)}</td>
                  <td className="nowrap">{r.client}</td>
                  <td><code>{r.tool ?? r.event}</code></td>
                  <td><Decision value={r.decision} event={r.event} tool={r.tool} /></td>
                  <td className="muted">{r.reason ?? (r.redactions ? `masked: ${r.redactions.join(', ')}` : '')}{r.durationMs !== undefined ? ` (${r.durationMs} ms)` : ''}</td>
                  <td><code className="hash" title={`hash ${r.hash}\nprevious ${r.prevHash}`}>{short(r.hash, 10)}</code></td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={7} className="muted">No records match.</td></tr>}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
