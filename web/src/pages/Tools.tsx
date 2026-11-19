import { useEffect, useState } from 'react';
import { api, short, type Tool, when } from '../api';

export function Tools({ token, tick, onError }: { token: string; tick: number; onError: (e: unknown) => void }) {
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api.tools(token).then(setTools).catch(onError);
  useEffect(() => {
    void load();
  }, [token, tick]);

  const act = async (t: Tool, kind: 'approve' | 'revoke') => {
    setBusy(t.key);
    setMessage(null);
    try {
      if (kind === 'approve') await api.approve(token, t.key, t.fingerprint);
      else await api.revoke(token, t.key);
      setMessage({ tone: 'ok', text: kind === 'approve' ? `${t.key} approved at fingerprint ${short(t.fingerprint)}.` : `Approval for ${t.key} withdrawn; it is quarantined again.` });
      await load();
    } catch (e) {
      onError(e);
      setMessage({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  if (!tools) return <p className="muted">Loading…</p>;
  const waiting = tools.filter((t) => t.status === 'quarantined');

  return (
    <>
      <header className="page-head">
        <h1>Tools</h1>
        <p>AI clients only see tools a person approved. A new or changed tool waits here, quarantined, until someone reviews this exact version.</p>
      </header>
      {message && <p className={`banner ${message.tone}`} role="status">{message.text}</p>}
      {waiting.length > 0 && (
        <p className="banner warn">{waiting.length} {waiting.length === 1 ? 'tool is' : 'tools are'} waiting for review. Open a row to see exactly what changed.</p>
      )}
      <section className="card flush">
        <table className="table">
          <thead><tr><th>Tool</th><th>Server</th><th>Access</th><th>Status</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {tools.map((t) => (
              <ToolRow key={t.key} t={t} open={open === t.key} busy={busy === t.key}
                toggle={() => setOpen(open === t.key ? null : t.key)} act={act} />
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function ToolRow({ t, open, busy, toggle, act }: {
  t: Tool; open: boolean; busy: boolean; toggle: () => void; act: (t: Tool, k: 'approve' | 'revoke') => void;
}) {
  const changed = t.approved && t.approved.fingerprint !== t.fingerprint;
  return (
    <>
      <tr className={t.status === 'quarantined' ? 'row-warn' : ''}>
        <td>
          <button type="button" className="disclose" aria-expanded={open} onClick={toggle}>
            <span aria-hidden="true">{open ? '▾' : '▸'}</span> <code>{t.key}</code>
          </button>
        </td>
        <td>{t.upstream}</td>
        <td>{t.readOnly ? <span className="badge muted-badge">Read-only</span> : <span className="badge info">Can change data</span>}</td>
        <td>
          {t.status === 'approved'
            ? <span className="badge ok">Approved</span>
            : <span className="badge warn" title={t.reason}>Quarantined</span>}
        </td>
        <td className="actions">
          {t.status === 'quarantined' && !t.suspicious && (
            <button type="button" className="primary small" disabled={busy} onClick={() => act(t, 'approve')}>Approve this version</button>
          )}
          {t.status === 'approved' && (
            <button type="button" className="secondary small" disabled={busy} onClick={() => act(t, 'revoke')}>Revoke</button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="detail">
          <td colSpan={5}>
            {t.reason && <p className="reason"><strong>Why it is quarantined:</strong> {t.reason}</p>}
            {t.suspicious && (
              <p className="banner bad">This definition contains text used in tool-poisoning attacks. It can't be approved here: the fix belongs in the server.</p>
            )}
            {changed ? (
              <div className="compare">
                <div>
                  <h3>Approved version <span className="muted small">{short(t.approved!.fingerprint)} · {t.approved!.by} · {t.approved!.at ? when(t.approved!.at) : ''}</span></h3>
                  <p className="desc">{t.approved!.description ?? '(not recorded)'}</p>
                </div>
                <div>
                  <h3>What the server sends now <span className="muted small">{short(t.fingerprint)}</span></h3>
                  <p className="desc changed">{t.description}</p>
                </div>
              </div>
            ) : (
              <div>
                <h3>Description the AI reads <span className="muted small">fingerprint {short(t.fingerprint)}</span></h3>
                <p className="desc">{t.description}</p>
                {t.approved && <p className="muted small">Approved by {t.approved.by}{t.approved.at ? ` on ${when(t.approved.at)}` : ''}.</p>}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
