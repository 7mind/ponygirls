# Haystack (working name) — implementation ledger

Service name: **haystack** (user-christened 2026-10-07; hidden ponyboi
reference — the farm store overhead, and the thing you find needles in.
Runners-up were `goldenoak`, `carousel`, `quill`). Name is final.
Replaces the plan's boring working name "agent-memory".
Plan: `docs/drafts/20261007-1828-agent-memory-implementation-plan.md`
Review ledger: `docs/drafts/20261007-1911-agent-memory-adversarial-review.md`
Review verdict: plan APPROVED as a document; not runtime verification.

Placement deviation (user-approved 2026-10-07): service lives **in-repo**
instead of a separate flake/repo. Proposed layout: top-level `haystack/`
(`src/ web/ migrations/ tests/ docs/`) + thin shims
`nix/pkg/haystack/package.nix`, `nix/nixos/haystack.nix`,
`nix/hm/haystack.nix` wired into the root flake. Ponygirls takes no
service-flake input (same-flake outputs instead); server runtime closure
must not pull harness packages; client HM module stays in `nix/hm/`.
Recorded as an approved deviation from plan §1/§7.

## Approved decisions (2026-10-07)

- JSON numeric domain: option (i) — lossless transport, no silent
  rounding. Stack must preserve large integers/decimals/Unicode/null
  through MCP → HTTP → PG JSONB → editor → query numerics → replay digest.
- Stack: TypeScript + official MCP SDK + React on current Node LTS. (Scala
  alternative dropped by user.)
- Model-backed trials: allowed. Pi: glm/kimi/xiaomi/muse within existing
  allowances. Claude/Codex: sonnet / sol 6.1 at low effort only.
- Launch preflight: DROPPED by user 2026-10-07 ("we start normally, if
  agent tries to access memory and mcp fails — so be it"). Approved
  deviation from plan §7.7: no bounded bearer whoami gate before launch;
  launches proceed with configured URL/token-file and failures surface at
  MCP call time. Residual risks accepted by user: wrong-identity launches
  not caught early (attribution skew), namespace mismatch undetected until
  writes diverge, dead-server sessions silently record nothing. Mitigations
  retained: exact-byte token reader (plan §7.6 stays), server whoami
  endpoint for diagnosis, documented "memory may be absent" agent context.
  Step 8/9 gates updated accordingly: verify start-without-server,
  call-time failure surfacing, no fallback-credential substitution.
- Name: haystack (final, user-christened).

## Step 0 — contracts + spikes (in progress)

### Pins (observed 2026-10-07, this tree)

- nixpkgs `c59305b` (2026-10-01); nested `871b9fd` via claude-code-sandbox
- node `24.20.0`, postgresql `18.6` (nixpkgs eval)
- claude-code `2.1.288`, codex `0.160.0`, pi-coding-agent `1.0.0` (nix/pkg/*)
- TODO: Home Manager rev used downstream (no HM flake input here; plan
  cites `fae6e9e` — resolve), MCP SDK + protocol revisions
  (2025-11-25 vs 2026-07-28), TS/React toolchain pins, GitHub GraphQL
  next-ID behavior fixtures.
- 2026-10-08: HM `fae6e9e42c3b762ab47635cddcfaf6f52374a61b` verified by
  fetching 4 files (copies in `debug/hm-pin-fae6e9e/`): `programs.mcp`
  enforces command⊕url, headers⇐url-only, env/args⇐local-only;
  `addType` maps url→`type:http`; codex renderer renames
  `headers`→`http_headers` with NO `bearer_token_env_var` synthesis
  (confirms the narrow native override in plan §7.5); claude emits
  `.mcp.json` via `transformMcpServer`+`addType`. Pi renderer is
  in-repo (`nix/hm/pi.nix`), not HM.

### Spikes

- S1 compat: disposable native HTTP+MCP endpoint, env-backed bearer,
  real Claude/Codex/Pi from generated config (Linux/Darwin × sandbox/direct).
- S2 fidelity: DONE (`lossless-json@4.3.1` pinned as the single codec).
- S3 codec/fixtures: DONE (codec vectors pass; GitHub digest vectors in
  `haystack/docs/github-accounting.md`).
- S1 live-harness legs (real Claude/Codex/Pi calls) deferred to the Step 9
  gate: model credentials live on the host, not in this sandbox.
- Contracts frozen as `haystack/docs/{decisions,model,query,auth,api,
  github-accounting}.md`; standing user go-ahead covers Step 1.

## Step 2 — domain service + dummy (DONE)

- `server/src/domain/`: qid codec, lossless JSON (`LosslessNumber` everywhere,
  exponent bound ±999999 enforced in the single parse entry), document
  validation (unknown top-level keys rejected — no authorship smuggling),
  `haystack-op-v1` digest.
- `server/src/storage/repository.ts`: narrow atomic CAS/replay contract;
  `memory.ts`: hand-written dummy (per-instance state).
- `server/src/application/`: service (get/put/history) + injected clock.
- Suites: `tests/` — qid (TS port of frozen vectors), json, digest,
  abstract `defineRepositoryContractSuite` (dummy leg now, PG leg Step 3),
  service scenarios. **65/65 pass** (`npm test`: tsc + node --test).
- Repro discipline catches: duplicate-create test reused the original
  request id (identical retry correctly returns committed — test fixed to
  use fresh ids); non-canonical test fixtures (fixed, not the code);
  unenforced exponent bound (real gap — enforced in `parseRaw`).
- Gate: BA/BG green; forbidden authorship + unsupported JSON rejected at
  the boundary; no mocks, no SQL coupling.

## Step 10 — shared agent instructions (DONE)

- `src/github/identity.ts` pins the accounting algorithm both sides
  share (canonical digest, key derivation, URL canon, record builder,
  collision check); `tests/github.test.ts` 9/9 incl. frozen vectors.
- HM bundle contributes the full policy to all harnesses when enabled
  (namespace + attention phrases asserted in checks); filing policy
  untouched; drafts inert by construction.
- Pi usability trial 1 (GitHub accounting, fixture, no live GitHub):
  agent derived the EXACT frozen key, CAS-created rev 1, attention
  required, searched + found. Finding: agent wrote status `filed` vs
  required `actual` → bundle tightened (memory status vs GitHub state).
- Pi usability trial 2 (skill draft, tightened text): deterministic
  `trial-activity:skill-draft-bearer-token-file-verify`, rev 1, status
  `actual`, attention required, rationale with observed-vs-hypothesis
  labeled honestly, overlap checked first, dangling cross-project link
  disclosed, no credentials, inert. Server-verified.

## Step 11 — release acceptance (DONE, modulo explicit operator items)

- Deploy-from-package + restart + backup/restore verified (deploy
  script 9/9; pg_dump restore into fresh DB; MCP get/search + CAS +
  replay on restored data). Upgrade policy, rotation, tuning, bounds,
  recovery in `haystack/docs/operations.md`. Measured numbers in
  `haystack/docs/query-perf.md` (no promises).
- Full suites green: server 157/157 (dummy-only 103+SKIPs), browser 7/7,
  all nix checks green (incl. yolo-profile).
- Adversarial review (this executor; no independent reviewer reachable —
  codex/gpt-6.1-sol needs OpenAI auth, absent): invariant-by-invariant
  audit of the plan found one defect (suggestIds emitted unencoded ids;
  fixed via fail-first repro). Secrets audit clean; non-goals absent.
- `haystack/quick-ui.sh [port] [bind]` (user request): one-command
  disposable UI test — scratch PG, real server, 3 seeded demo items,
  prints URL + token, full cleanup on exit. LAN mode
  (`0.0.0.0` bind) proven: LAN health/login/browse, evil-Host 403,
  plain dev cookie over HTTP. Proven here incl. its own bugs found by
  testing (stale-dist rebuild, loud readiness gate, bash env-assignment
  quoting, defensive trap, GNU-only `hostname -I`, missing LAN IP in
  allowlists). /health intentionally skips Host validation (liveness).
- EXPLICITLY OPEN (need user action, never silently passed): live
  Claude tool calls (no Anthropic key in sandbox — connection proven);
  Darwin native clients (mbap bare); production deployment/publish/push
  (unauthorized); host-level verify-configs + TLS e2e on a NixOS host.
- 2026-10-08: live Codex trial CLOSED (user found OAuth in ~/.codex).
  `codex exec` (gpt-6.1-sol, low effort, isolated CODEX_HOME, -c MCP
  overrides, bearer env): get/put/search all completed natively;
  server-verified rev 1, author w-agent, status actual. Real config
  untouched; OAuth copy deleted afterwards.

## Step 9 — ponygirls integration (DONE)

- `dev-llm.nix` aggregates `haystack.nix` (no extra toggle); auto-enable
  only when fully resolvable; enrolled-but-unmapped is a top-level
  actionable assertion. Unrelated MCP servers survive (asserted); Codex
  merge replaces only the haystack entry (source-verified).
- Native-client evidence (Linux, direct launch, disposable server+PG):
  Claude `mcp list` → ✔ Connected (placeholder expansion + bearer);
  Codex parses streamable_http + bearer env (live calls need OpenAI auth
  — absent here, reported); Pi `mcp list` → connected + tool discovery.
- Pi model trial (xiaomi/mimo-v2.6-pro, pre-approved): get ✓, put ✓
  (server-verified rev 1), honest typed-error + replay handling on a bad
  prompt, verbatim search hit ✓. Findings: keep deferred exposure
  (direct advertises nothing in `-p` mode despite `list` showing
  connected); dead server surfaces as explicit `failed/fetch failed`.
- yolo sandbox: validated HAYSTACK_TOKEN composed (43 bytes in-sandbox),
  bad file → explicit rejection, exit 3, launch never runs.
- Gaps (explicit, not passing): live Claude/Codex tool calls (no model
  keys in sandbox); Darwin native clients (mbap reachable but bare — no
  toolchain); yolo-sandboxed agent runs (need models). HM evaluates for
  darwin; live proof stays a Step 11/operator-trial item.

## Step 8 — NixOS + Home Manager modules (DONE)

- Production entrypoint (`server/src/index.ts`): file config → loadAuth
  ($CREDENTIALS_DIRECTORY expansion) → migrate → listen; readiness before
  socket; graceful drain; liveness `GET /api/v1/health` (public, no-store).
- `nix/nixos/haystack.nix`: users/tokens/clients/activityProjectId, local
  PG (ensureDBOwnership, peer auth), role-scoped tuning via setup service,
  LoadCredential digests, hardened unit, pg_dump timer + retention, optional
  nginx proxy (cache off) + firewall discipline, mapping assertions (agent
  type, known token, loopback default).
- `nix/hm/haystack.nix`: one `programs.mcp` entry with literal
  `Bearer ${HAYSTACK_TOKEN}` (Claude/Pi native expansion, source-verified),
  narrow Codex `bearer_token_env_var` override (merge-verified), validated
  vars wiring, `haystack-run` direct-launch wrapper, standalone + osConfig
  mapping resolution, actionable assertions.
- yolo exact-byte seam (Linux + Darwin launchers, package args, HM
  option): validated loop proven (43/44 accept; size/charset/embedded/
  missing → exit 3); generic secrets untouched (`yolo-profile` green).
- Gates: NixOS matrix (full/server-only/negative mappings) +
  HM matrix (linux/darwin/mapped) + wrapper execution tests green;
  `tests-deploy/local-boot.sh` 9/9 against the real nix-built binary
  (start, flows, restart persistence, revocation fail-closed, no store
  secrets); server suites 146/146. Re-export pin: same in-repo module
  identity (nothing to re-pin). TLS e2e stays a Step 11 host trial.

## Step 7 — web UI (DONE)

- `web/src/`: fragment-routed app (browse/detail/inbox), token login,
  query editor with diagnostics/completion, tri-state archive control
  composing with the AST, keyset paging with a page-start stack, JSON +
  link editors, incoming/outgoing navigation (dangling/archived labeled),
  history snapshots/side-by-side compare/restore-as-new, attention inbox
  preset + clearing, conflict panel preserving drafts with latest-revision
  retry, escaped-only rendering + meta CSP, distinct auth/network failures.
- 7/7 controlled Chromium checks (nixpkgs chromium + playwright-core):
  login/persistence/logout+history, search/diagnostics/archive, big-int
  fidelity + XSS inertness (no dialogs, no elements), two-editor conflict,
  history/restore, inbox/clearing, API-outage distinction.
- Real findings: `__Host-` cookies are HTTPS-only (dev uses explicit
  `haystack-dev` name); browser needs the lossless codec too
  (LosslessNumber revision crashed React — envelope numbers converted,
  fields stay canonical text); per-request repo pools exhaust PG
  (single shared repo/pool per app); load() wiped save outcomes
  (keepStatus); unstable inline onAuthLost remounted data (useCallback).
- Server suites stay 146/146; dummy-only green; nix build green.

## Step 6 — MCP adapter (DONE)

- `mcp/adapter.ts`: get/put/search over stateless Streamable HTTP
  (2025-11-25), per-request server factory, same service + same bearer
  auth. Cookies rejected on /mcp; raw document_json preserves numerics;
  init guidance text; honest annotations; explicit 406 for unsupported
  protocol versions; no-store pinned past the SDK transport's own header.
- Tests over a real SDK client: initialize/list/call, CAS conflict as
  typed tool error, lost-response replay, keyset pagination, cookie-only
  and naked rejection, version/GET explicitness, log allowlist.
  **146/146 pass** (dummy-only 94 + SKIP markers).
- Real findings: raw fetch needs Accept headers (auth runs first, so 401s
  passed without them); stateless SDK ignores protocol versions (explicit
  pre-check added); SDK overwrites Cache-Control (pinned to no-store);
  test-doc JS numbers round before send (raw-text fixtures again).

## Step 5 — authenticated HTTP application (DONE)

- `auth/`: token codec (43-char base64url, exact-byte files, SHA-256 of
  ASCII bytes, constant-time match), static config loader (fails closed on
  dup users/tokens, bad types, double digests, unreadable files).
- `http/server.ts`: bearer-only `/api` + cookie-or-bearer browser API,
  ambiguous-credential rejection, login/logout/whoami, get/put/search/
  history/analyze/complete/values, Origin/Host/CSRF rules, no-store +
  no-referrer, rolling `__Host-haystack` cookie, per-principal rate limits,
  raw-canonical document bodies (no JSON.parse rounding), allowlisted
  structured logging, typed fault mapping.
- Tests: 16 HTTP scenarios over real PG + sockets (auth matrix, flags,
  restart persistence, revocation, attribution, CSRF, host, headers,
  faults, history/completion/values, canary log allowlist incl. fault
  paths, rate limits, renewal, forward-proxy hop) + PG-independent auth
  unit tests. **141/141 pass** (dummy-only 93 + SKIP markers).
- Real findings: parallel test files need separate DBs (TRUNCATE races);
  ambiguous-credential rejection is load-bearing in tests (jar+bearer);
  res.json would round big ints (raw-canonical bodies).

## Step 4 — query language + search (DONE)

- `query/`: lexer (UTF-16 spans), recursive-descent parser (NOT>AND>OR,
  implicit AND, JSON-escaped phrases), NFKC/LNM text normalization,
  strict RFC6901 resolver. Archive default wraps the whole AST (browse
  included); explicit selectors anywhere disable it.
- `query/evaluate.ts`: pure dummy evaluator. `postgresSearch.ts`: fixed-
  template SQL compiler (bound params only) + `haystack_exists/resolve`
  PL/pgSQL functions masking PG's negative-index behavior.
  `application/search.ts`: fingerprint-bound keyset cursors, analyze,
  bounded completion. Migration 0002: projections, GIN + metadata indexes.
- Abstract search suite (15 scenarios × 2 legs) incl. precedence, phrase
  boundaries, missing≠null, lossless numerics, link correlation,
  scope/target separation, archive composition, paging, cursor binding,
  injection-as-data. **118/118 pass** (dummy-only 85 + SKIP).
- Real findings: PG txn-poisoning discipline (from Step 3) held; nested
  arrays can't bind as PG arrays (joined segment strings); qualified-id
  completion must match across the `:` boundary; browse needed the archive
  default; parser no-progress guard (deep-nesting hang → diagnostic).
- Measured (5k docs, `docs/query-perf.md`): id 0.09ms indexed; text GIN
  5.37ms; broad negation + pure-JSON predicates are disclosed seq scans.
  No latency promises made.

## Step 3 — PostgreSQL adapter (DONE)

- `migrations/0001-initial.sql`: items (+document_text authority +
  jsonb projection), item_revisions, item_links (no FKs, target index),
  write_requests, store_metadata, ledger. `migrate.ts`: advisory lock,
  per-file txns, ledger, activity-namespace reconcile (mismatch fails).
- `postgres.ts`: same contract; one txn per commit (replay → lock →
  recheck → CAS → revision+current+links+replay). Key correctness fix
  found by the PG leg: bare failing INSERTs poison txns (25P02) — all
  speculative writes are now ON CONFLICT DO NOTHING + re-read resolution.
  Reads use document_text (node-pg jsonb parsing would round via JSON.parse).
- Suites split into `tests/suites/` (abstract) + thin legs; PG leg skips
  explicitly without HAYSTACK_TEST_PG. **69/69 pass** on disposable PG 18.6
  (pinned nixpkgs, /tmp socket, trust auth); dummy-only 50/50 + SKIP marker.
- PG-only proof: 10-way create race → 1 winner + projection counts
  (1/1/10); 8-way identical-id → 1 write + 7 replayed; 4-way payload
  conflict → 1 + 3 replay-conflicts; gap-free history; real pg_ctl
  restart + rerun green; golden digest vector pinned; concurrent
  migrate() converges; bad migration rolls back cleanly; namespace
  mismatch fails startup. Prior authors/tokenIds retained in history.
- nix hash refreshed (`prefetch-npm-deps`); `nix build .#haystack` green.

## Step 1 — scaffold (DONE 2026-10-08)

- Layout: `haystack/{server,web}/` (npm workspaces + lockfile),
  `nix/pkg/haystack/package.nix`, `nix/nixos/haystack.nix` (loopback-only
  stub), `nix/hm/haystack.nix` (url/tokenFile/identity options stub),
  flake outputs `packages.haystack`, `checks.haystack{,-hm-eval,-nixos-eval}`,
  `homeManagerModules.haystack`, `nixosModules.haystack`.
- Dep pins: TS 7.0.2, SDK 1.32.1, express 4.21.2 (deliberate: latest is
  5.x, API differs), lossless-json 4.3.1, pg 8.23.1, zod 4.6.5,
  react 19.3.0, vite 8.3.3, plugin-react 6.1.2, @types/* matching.
- Gates: sandboxed `nix build .#haystack` ✓ (reproducible out path);
  UI rebuild byte-identical ✓; store binary offline launch ✓
  (`/health` ok, `/mcp` 501, static UI served); HM eval linux+darwin ✓;
  NixOS eval ✓; closure free of harness packages ✓.
- Notes: `git add -N` required for new files to enter the flake tree;
  `--expr getFlake` bypasses the git filter (use `nix build .#…`).

### Log

- 2026-10-07: ledger created; version pins (partial) recorded; spikes S1–S3
  not yet run. No service code written. Tree otherwise untouched.
- 2026-10-07: S1-compat spike `debug/haystack-s1/` (SDK 1.32.1 +
  express 4.21.2, stateless Streamable HTTP, bearer from exact-byte file
  reader). initialize/list/call all pass; no-auth→401, cookie-only→401,
  GET→405. SDK finding: one McpServer cannot serve stateless HTTP across
  requests (`Already connected` crash → socket close); per-request server
  factory required. SDK 1.32.1 pins protocol 2025-11-25 (stateless, no
  session/GET stream); 2026-07-28 is NOT in this SDK — pinned decision:
  implement 2025-11-25 rules only, no doc-mixing. Live Claude/Codex/Pi
  trials deferred to Step 9 gate (model creds live on host, not sandbox;
  allowed models pre-approved). Token format verified: 32 random bytes →
  43-char base64url; reader accepts 43B/43B+LF, rejects all else.
  6 round-trips (incl. `a:b`/`i%d`, spaces, cafe/pony Unicode, case)
  + 12 rejection vectors (empty, colons, lowercase hex, escaped
  unreserved, bad/truncated escapes, NUL, `+`) + decode-once usage demo.
  One spike-authored vector was wrong first (`a%253Ab` IS canonical data
  for project `a%3Ab`); corrected after reading the failure, per repro
  discipline. TS implementation (Step 2) must satisfy the same vectors.
- 2026-10-07: S2-fidelity spike: `JSON.parse` provably rounds
  9007199254740993→...992 (the forbidden silent corruption).
  `lossless-json@4.3.1` preserves (LosslessNumber), stringifies
  byte-identical, and rejects trailing commas AND duplicate object keys
  (required for replay-digest hashing). Contract consequence: MCP SDK
  parses params with JSON.parse internally, so arbitrary JSON travels as
  a raw-text string field and is lossless-parsed once at the application
  layer — for MCP params, browser API bodies, and PG JSONB paths.
