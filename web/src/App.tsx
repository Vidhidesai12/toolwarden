import { useCallback, useEffect, useState } from 'react';
import { api, type Overview as OverviewData, saveToken, savedToken, Unauthorized } from './api';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Tools } from './pages/Tools';
import { Clients } from './pages/Clients';
import { Audit } from './pages/Audit';

const PAGES = ['overview', 'tools', 'clients', 'audit'] as const;
export type Page = (typeof PAGES)[number];
const LABELS: Record<Page, string> = { overview: 'Overview', tools: 'Tools', clients: 'Clients', audit: 'Audit log' };

function pageFromHash(): Page {
  const h = window.location.hash.replace('#/', '');
  return (PAGES as readonly string[]).includes(h) ? (h as Page) : 'overview';
}

export function App() {
  const [token, setToken] = useState<string | null>(savedToken);
  const [page, setPage] = useState<Page>(pageFromHash);
  const [summary, setSummary] = useState<OverviewData | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // One clock for the whole app: every page re-fetches when it ticks, every 5 seconds.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 5000);
    return () => window.clearInterval(id);
  }, []);

  const logout = useCallback(() => {
    saveToken(null);
    setToken(null);
    setSummary(null);
  }, []);

  const onError = useCallback((e: unknown) => {
    if (e instanceof Unauthorized) logout();
  }, [logout]);

  useEffect(() => {
    if (!token) return;
    api.overview(token).then(setSummary).catch(onError);
  }, [token, tick, onError]);

  if (!token) {
    return <Login onLogin={(t) => { saveToken(t); setToken(t); }} />;
  }

  const go = (p: Page) => {
    window.location.hash = `#/${p}`;
  };
  const quarantined = summary?.tools.quarantined ?? 0;
  const allUp = summary ? summary.upstreams.every((u) => u.up) : true;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <div>
            <strong>ToolWarden</strong>
            <span>MCP security gateway</span>
          </div>
        </div>
        <nav>
          {PAGES.map((p) => (
            <a key={p} href={`#/${p}`} className={p === page ? 'active' : ''} aria-current={p === page ? 'page' : undefined}>
              {LABELS[p]}
              {p === 'tools' && quarantined > 0 && <span className="pill warn" title="Tools waiting for review">{quarantined}</span>}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <span className={`dot ${allUp ? 'ok' : 'bad'}`} aria-hidden="true" />
          {summary ? (allUp ? 'All servers reachable' : 'A server is unreachable') : 'Connecting…'}
          <button type="button" className="link" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        {page === 'overview' && <Overview token={token} tick={tick} data={summary} go={go} onError={onError} />}
        {page === 'tools' && <Tools token={token} tick={tick} onError={onError} />}
        {page === 'clients' && <Clients token={token} tick={tick} onError={onError} />}
        {page === 'audit' && <Audit token={token} tick={tick} onError={onError} />}
      </main>
    </div>
  );
}
