# Shared account web UI

`account.js` and `account.css` implement dependency-free login and native account
settings against `/api/account/v1`. Integrations provide `data-account-login`
forms and `data-account-settings` buttons with the current stable
`data-account-user-id`. Dispatch `account:invalidate` when the application
invalidates its account lifecycle; `account:changed` requests application identity
revalidation after a mismatched account response.

## Token creation recovery

A mint POST is non-idempotent. Once sent, any failure—including HTTP 400, 401,
403 or 409—can leave its commit outcome unknown. Account v1 has no validated
no-commit receipt, so an HTTP status never authorizes replay. A validated success
response establishes creation before the follow-up account read, but a failed
read still withholds the secret and requires recovery.

Recovery metadata belongs to its particular creation intent and owner. Closing,
invalidating or reopening the dialog does not discard it while the page remains
loaded. Late responses cannot clear or relabel a newer intent. The user must
explicitly refresh the token list and acknowledge reconciliation before another
creation is enabled. If a token was created but its one-time secret was lost,
revoke it before creating a replacement.

Recovery metadata is **in memory only**. Reloading or signing in through a full
page reload clears the warning; it never submits or retries creation. After an
interrupted creation or signing in again, inspect and refresh the token list
before creating another token. There is no persistent browser recovery ledger.
Passwords and token secrets are never placed in browser storage.

## Verification

From the repository root, run the complete controlled Chromium suite with the
pinned development shell:

```bash
nix develop .#chronicle --command node shared/account-web/tests/browser.mjs
```

These tests use controlled local account routes and real browser DOM, focus,
clipboard and cookie behavior. They do not establish backend transaction or
production deployment behavior; application acceptance uses the real service
and an owned disposable database separately.
