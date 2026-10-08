# Haystack — operations guide (Step 11)

## Token provisioning and rotation

Tokens are 32 random bytes, canonical unpadded base64url (43 chars).
Generate outside the Nix store (example on a trusted machine):

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" > agent.token
chmod 600 agent.token
sha256sum agent.token | cut -d' ' -f1 > agent.sha   # digest file
```

- Agent bearer tokens live as raw-token files per account
  (`clients.<account>.tokenFile`, e.g. agenix `/run/secrets/...`).
  Human browser tokens are provisioned the same way and pasted once at login.
- Server digests (`users.<id>.tokens.<tid>.tokenHashFile`) hold SHA-256 hex;
  deliver them via the module's `LoadCredential` mapping (root-owned,
  service-inaccessible otherwise). Never commit tokens or digests to git,
  never pass them in argv, never log them.
- Rotation without downtime: add a second token ID with its digest file,
  distribute the new raw token, restart/reload, verify `whoami` on the new
  token, then remove the old token ID and restart/reload again. Overlapping
  IDs are the mechanism; there is no in-place token edit.
- Revocation: remove the token/user from configuration and restart/reload.
  Committed operations are unaffected; in-flight requests finish with the
  identity they started with. Cookie sessions revalidate on every request.

## Backend outages and browser sessions

The NixOS nginx proxy serves the public UI shell and assets directly from
the Haystack package. `/api/` and `/mcp` go to the backend, including
WebSocket upgrades. With `proxy.enable = false` (external edge: TLS
terminates elsewhere and forwards Host-intact), the edge must reproduce
this contract itself — UI shell from the package's `web/dist` with
`Cache-Control: no-cache`, `/api/` and `/mcp` proxied with upgrades,
caching and buffering off, and the same typed 503 (no cookie changes) on
backend outage; `publicUrl` still drives the server allowlists. A stopped backend or gateway timeout produces a typed
HTTP 503 response with `Cache-Control: no-store` and no cookie changes;
application authentication failures remain 401. The frontend reports
service unavailability without discarding the persistent session cookie.
Restarting the backend with the same token configuration restores access
on refresh or retry, within the cookie's normal lifetime.

The standalone preview serves its own assets. If that whole process is
stopped, the browser cannot load the page until it restarts. `quick-ui.sh`
retains its per-port login token in `debug/haystack-ui/<port>/token.txt`
under the repository root, so its cookie survives launcher restarts too.
The token file is private and ignored by git; demo data is still recreated
on each launch. Delete that token file to deliberately reset preview login.
To keep a session from an older disposable launcher, save its printed token
to this file before stopping that launcher; otherwise the first launch of
the updated script requires a new login.
The independent outage screen requires the nginx proxy.

The browser restart regression runs a real backend process and nginx over
HTTPS with a disposable certificate, using the module's location policy.
After building both workspaces, run from `haystack/` with PostgreSQL,
Chromium, nginx, Nix, OpenSSL, and PostgreSQL tools available:

```sh
HAYSTACK_TEST_PG=postgresql://postgres@127.0.0.1:5432/haystack_test \
HAYSTACK_CHROMIUM=/path/to/chromium HAYSTACK_NGINX=/path/to/nginx \
npm run test:browser -w web
```

This uses dedicated `haystack_browser` and `haystack_restart` databases,
recreated by the test. The launcher regression also runs its own disposable
PostgreSQL instance on a separate port. Missing runtime inputs produce
explicit skip markers.

## Backup and restore

Automated `pg_dump -Fc` runs on `backup.schedule` into `backup.directory`
with `retentionDays` pruning (see `nix/nixos/haystack.nix`). Secret
configuration (digest/token files) is backed up through the operator's
secret manager, never alongside item exports.

Restore into a fresh instance (verified 2026-10-08 on disposable PG 18.6):

```sh
pg_restore -d haystack_restored trial.dump
# then boot the BUILT package (not a source checkout) against it:
HAYSTACK_AUTH_JSON=... HAYSTACK_DATABASE_URL=... haystack-server
```

Verified post-restore: current items, full history with authors/token IDs,
links, activity namespace, CAS conflicts on stale revisions, write+replay
convergence. `store_metadata.activity_project_id` mismatch fails startup —
a namespace change needs a reviewed migration, never a fresh database.

## Upgrades

- Item revisions are immutable; replay digests (`haystack-op-v1`) keep
  their comparison semantics across upgrades — old request IDs are never
  reinterpreted with a new algorithm (golden vector in tests).
- Schema changes ship as ordered `migrations/*.sql` with ledger +
  advisory lock; a failed migration fails startup without partial apply.
  Never auto-upgrade the PostgreSQL major version; never recreate data.
- The 2026-10-08 JSON codec correction preserves `__proto__` fields that
  the previous parser/canonicalizer discarded. Previously discarded values
  cannot be reconstructed from stored revisions. Replaying an old request
  containing such a field may now conflict because its exact canonical
  document differs; use a fresh request ID and the current revision to
  explicitly write the intended value.
- Upgrade procedure: backup → deploy new package → restart (migrations
  run before listen) → verify `/api/v1/health` + `whoami` + a replayed
  write → keep the old package generation until verified.

## Resource tuning

Role/database-scoped settings via `tuning` (applied by `haystack-setup`
as `ALTER ROLE ... IN DATABASE`): SSD/NVMe planner profile, bounded pool
(default 8), per-operation `work_mem`, statement/lock/idle timeouts, JIT
off for short interactive queries. Cluster-wide settings
(`shared_buffers`, WAL/checkpoint, IO) need an explicit operator-approved
cluster profile — the module never retunes unrelated databases.
Durability stays on: `fsync`, `full_page_writes`, commits, autovacuum.

Measured baselines (5k synthetic docs, loopback, `docs/query-perf.md`):
id 0.09 ms indexed; text-GIN 5.4 ms; broad negation + pure-JSON scans
disclosed. No latency promises: agree performance targets separately
before treating any number as a delivery gate.

## Known bounds (disclosed, never silent)

1 MiB documents, depth 64, 256 links, 64 tags (each ≤ 128 chars), 256 KiB
string leaves, number exponents ±999999, 100-item search pages, live
(non-snapshot) keysets, 4k-char/512-token/128-node/16-deep queries.
Terminal replay outcomes are retained durably (no TTL) in v1.

The browser live channel uses per-nonce heartbeat deadlines, overlapping
replacement connections (maximum three), a 10-second connect timeout,
15-second stale grace, and jittered exponential backoff capped at 30 seconds.
After 12 failed attempts, or a permanent protocol/session close, automatic
reconnection stops and the connection panel offers **Try again**. Reconnects
defer while hidden; lifecycle events and time jumps proactively recheck or
replace connections. The server sends correlated protocol pings every 30
seconds and defers stale-peer termination until after I/O handling.

The header indicator reports heartbeat-verified state and deadline budgets;
its panel shows the active connection, RTT windows, missed heartbeat ratio,
retry state, last close, and a bounded event log. The tab title mirrors its
state. Browser timers remain on the main thread: hidden-tab throttling can
delay heartbeat handling; visibility/resume and time-jump detection recover
on return. No uninterrupted background-delivery guarantee is made.

The NixOS reverse proxy enables WebSocket upgrades. An external proxy must
also forward upgrades for `/api/v1/live`; otherwise the panel reports failed
connection attempts and eventually stops. Ordinary API reads and writes
still report their own outcomes independently of live-channel health.

## Incident recovery

- Wrong-identity writes: tokens are the identity; find the token ID in
  history, revoke it, and repair data with explicit CAS writes (history
  shows exactly what changed).
- Dead server: launches are NOT gated (user decision) — agents report
  memory failures at call time. Check `systemctl status haystack`,
  PostgreSQL, then backup freshness.
- Suspected secret leak: rotate the affected token IDs (above), clear
  browser cookies (logout), and check proxy/application logs for the
  allowlisted schema (no bodies/keys/credentials should be present —
  verify with canary greps as in the test suites).
