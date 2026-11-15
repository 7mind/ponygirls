# Shared service accounts

`serviceAuth` owns password verification, opaque browser sessions, issued API
credentials, and the separately versioned account JSON protocol. It does not own
service permissions, origins, HTTP admission, database connections or transactions.
`AccountSql` receives the caller's existing `Connection`; initialize once at startup
and reconcile the complete loaded declarative directory on startup/configuration
replacement before accepting account operations. Reconciliation persists current
account fingerprints and disabled tombstones. Login checks that current state
under the same owner lock: an old request waiting behind removal, disable or a
password replacement cannot recreate revoked authority. Password hashes themselves
are not copied into the directory table. Never invoke a second database
transaction from inside an existing callback.

Use `AccountSql.loginReplacing` when password login replaces an existing cookie.
It acquires the target and prior owners in sorted order, matching reconciliation,
then creates the new session and revokes only the valid presented old session.
Wrong credentials leave the old session intact. Its returned prior credential
lets the service invalidate derived grants in the same transaction.

Haystack and Manure use the shared tables. Chronicle retains its scoped-token,
sharing and security-epoch tables and adapts them to the same account boundary.
Password hashes retain Chronicle's `pbkdf2-sha256$rounds$salt$hash` format.
References to password/hash files are runtime secrets, never Nix-store values.

## Session and token guarantees

- Browser sessions have independent random secrets and **no server-side expiry**.
  Logout deletes the current session; copied cookies then fail. Sessions survive
  service restart, but removal/disable/password replacement invalidates them.
- Browser-session secrets cannot be API bearer tokens and vice versa. Account
  management requires a current browser session, never an API bearer credential.
- Issued API secrets are random 256-bit values; only SHA-256 digests are stored.
  A secret is returned once, never included in token lists or receipts. In
  Haystack/Manure, removal or disable persistently revokes issued credentials;
  restart does not recreate them. Chronicle retains its existing disabled-owner
  bearer gate and explicit token-revocation lifecycle.
- Configuration-managed token metadata is visible, but only declarative changes
  may rotate/remove those credentials. Services enforce this, not just the UI.
- H/M issued tokens have the owner's existing API authority (`api`). Chronicle
  retains `Ingest`, `Read`, `Raw` and the `Raw`-requires-`Read` constraint.
- Haystack/Manure retain at most 100 active issued tokens and 100 recently revoked
  metadata records per owner. Chronicle retains its existing total active-token
  quota and bounded-list policy. Revoking an issued token rejects its secret.
- Persistent cookies use 400-day browser retention, refreshed on use. This is not
  a session timeout. Browsers may cap/evict cookies or users may clear them; the
  server cannot guarantee retention of client-side storage indefinitely.

## Account HTTP protocol v1

The account plane is an intentional addition to each service's domain API.
Prefix: `/api/account/v1`. Requests reject query parameters, duplicate JSON keys,
unknown fields, invalid UTF-8 and oversized/deep bodies. `AccountJson.parseUtf8`
provides the shared 16-KiB, depth-eight boundary. Use exact validated service Host
and Origin, cookie-only account authority, HttpOnly host-only SameSite=Strict
cookies (Secure for HTTPS), no-store responses and sanitized failure codes.
Revalidate authority after asynchronous input and before effects/delivery.

| Method/path | Input | Output |
|---|---|---|
| POST `/login` | `{login,password}` | `{user}` plus session cookie |
| POST `/logout` | `{}` | `{ok:true}` and cleared cookie |
| GET prefix | none | `{user,tokens,scopes}` |
| POST `/tokens` | `{name,scopes:[...]}` | `{token,secret}` once |
| POST `/tokens/{id}/revoke` | `{}` | `{ok:true}` |

User metadata: `{id,login,displayName,actor}`. `actor` is a public, opaque owner
binding, not a credential. Every account mutation except login must send exactly
one `X-Account-Actor` header from the preflight account response. Services compare
it to the current session owner inside the mutation transaction; a different
owner returns HTTP 409 without effects. This closes the cross-tab cookie-switch
race between preflight and POST. Token metadata:
`{id,name,source:"configured"|"issued",createdAt:string|null,revoked,scopes}`.
Failures: `{error:{code,message}}`; no submitted secrets or raw exceptions.
Configured-token revocation returns forbidden; a different owner's token is not
found. Account login accepts login/password, not legacy bearer-token exchanges.

A failed/unknown mint acknowledgement is **not safe to retry automatically**:
reconcile the token list, revoke a newly created token whose secret was lost,
then explicitly issue a replacement. The common browser UI preserves this
uncertainty and never stores secrets in browser storage.

## Verification

```bash
nix develop .#backend --command bash shared/service-auth/scripts/test-postgres.sh
```

The same behavioral account contracts run against a handwritten memory repository
and real owned PostgreSQL; the script verifies the complete discovered XML
inventory without skips. Service-specific transport, scopes, live-delivery and
content-grant checks remain in their respective full suites.
