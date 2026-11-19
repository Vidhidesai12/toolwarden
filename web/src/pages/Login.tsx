import { type FormEvent, useState } from 'react';
import { api, Unauthorized } from '../api';

export function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.overview(token.trim());
      onLogin(token.trim());
    } catch (err) {
      setError(err instanceof Unauthorized ? 'That admin token was not accepted.' : 'ToolWarden is not reachable.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">
          <img src="/favicon.svg" alt="" width={36} height={36} />
          <div>
            <strong>ToolWarden</strong>
            <span>MCP security gateway</span>
          </div>
        </div>
        <label htmlFor="token">Admin token</label>
        <input id="token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)}
          placeholder="tw-demo-admin for the local demo" autoFocus />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={busy || !token.trim()}>{busy ? 'Checking…' : 'Sign in'}</button>
        <p className="hint">The admin token is separate from every AI client token, so an AI can never approve its own tools. It is kept only for this browser tab.</p>
      </form>
    </div>
  );
}
