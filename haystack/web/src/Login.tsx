import { useState } from "react";
import { api, AuthError, NetworkError } from "./api";

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
    <main>
      <h1>haystack</h1>
      <p>Sign in with a provisioned token. It is stored in a persistent HttpOnly cookie on this browser only.</p>
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
        <button type="submit" disabled={busy || token.length === 0}>
          Sign in
        </button>
      </form>
      {error !== null && (
        <p role="alert">{error}</p>
      )}
    </main>
  );
}
