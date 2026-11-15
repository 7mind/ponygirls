import { Icon } from "./Icon";

export function Login() {
  return (
    <main className="auth-screen">
      <div className="auth-card"><span className="brand-mark"><Icon name="stack" /></span>
      <h1>Sign in to Haystack</h1>
      <p>Records, upstream activity, and skill candidates.</p>
      <form data-account-login="" method="post" action="/api/account/v1/login">
        <label>
          Username
          <input name="login" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="primary" type="submit">Sign in</button>
      </form>
      <small className="auth-note">Use your account username and password. Your session stays in an HttpOnly browser cookie until you sign out.</small>
      </div>
    </main>
  );
}
