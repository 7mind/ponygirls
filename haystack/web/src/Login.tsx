import { useState } from "react";
import { api, AuthError, NetworkError } from "./api";
import { Icon } from "./Icon";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.login(token);
      setToken("");
      onLogin();
    } catch (err) {
      if (err instanceof AuthError) setError("Invalid token.");
      else if (err instanceof NetworkError) setError("Server unreachable — the service may be down.");
      else setError("Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-card"><span className="brand-mark"><Icon name="stack" /></span>
      <h1>Sign in to Haystack</h1>
      <p>Records, upstream activity, and skill candidates.</p>
      <form onSubmit={submit}>
        <label>
          Token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            aria-label="Token"
          />
        </label>
        <button className="primary" type="submit" disabled={busy || token.length === 0}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {error !== null && (
        <p role="alert">{error}</p>
      )}
      <small className="auth-note">Use your provisioned token. Your session stays in an HttpOnly browser cookie.</small>
      </div>
    </main>
  );
}
