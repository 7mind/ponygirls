# Rites

A browser-managed, multi-user repository agent service: a native Scala
coordinator schedules Markdown prompts, runs Pi's TypeScript SDK, and publishes
GitHub pull requests or GitLab merge requests.

Controlled native, browser and configured-model acceptance passed. See
[VALIDATION.md](VALIDATION.md) for source-bound results and coverage limits.
This implementation has not been deployed and has not created proposals on real
remote repositories; a package build alone is not application acceptance.

## Application contract

- Operator-provisioned password accounts; no signup or credential retrieval.
- Repository owners manage repository configuration and grants. Editors manage
  rites and start runs; viewers inspect configuration and run history.
- Forge credentials belong to their user and are explicitly bound to repositories
  owned by that user. Browser entry is write-only. PostgreSQL stores authenticated
  AES-256-GCM ciphertext, not plaintext access or refresh tokens.
- A rite selects a repository-relative regular Markdown file, a configured model
  and a five-field UTC cron expression. Manual runs use idempotency request IDs.
- The coordinator freshly fetches the base, prepares a credential-free working
  tree, invokes the worker and exports supported regular-file changes into a
  separate trusted Git checkout. Repository hooks and credential helpers are
  disabled. Symlinks and submodules are unsupported.
- No-change or failed agent runs do not supersede older proposals. A new proposal
  must be created and verified before recorded same-rite predecessors are closed.
  There is no automatic merge or identical-content proposal deduplication.
- Possibly dispatched publication or OAuth refresh operations are not blindly
  replayed after a lost response. Uncertainty remains explicit in service state.

The release target is one coordinator per PostgreSQL database, with concurrent
users and bounded concurrent runs inside that coordinator. Do not deploy replicas
against one database: startup refuses a second coordinator and ownership loss
fails the service closed. Operator account/configuration changes require a process
restart; startup reconciliation applies account revocation and session changes.

## Build and configure

Supported packaged runtime: `x86_64-linux`, with working unprivileged bubblewrap
user/PID namespaces and ordinary outbound networking.

```bash
nix build .#rites
./result/bin/rites-server check-config /absolute/private/config.json
./result/bin/rites-server migrate /absolute/private/config.json
./result/bin/rites-server serve /absolute/private/config.json
```

The package also provides `rites` and `rites-worker`. `check-config` is not a
connectivity or application-acceptance test. The web assets are supplied by the
package; an explicit `webRoot` overrides them.

Use [config.example.json](config.example.json) as a structural example, not a
production configuration. All example names, endpoints and secrets are synthetic.
Keep real configuration, model selections, keys, password hashes and traces
outside this checkout and the Nix store. Use private service-owned directories
(mode 0700) and secret files (mode 0600); provision PostgreSQL and an HTTPS reverse
proxy separately. No deployment is performed by these build commands.

The vault master key is 32 random bytes encoded as base64url. Generate it once
and back it up with the database; replacing it is not credential re-encryption.
For example, within an already private operator directory:

```bash
umask 077
python3 -c 'import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())' > master-key
read -rs -p 'Account password: ' password
printf '\n' >&2
printf '%s\n' "$password" | /absolute/package/bin/rites-server password-hash > owner-password.hash
unset password
```

Do not put passwords in process arguments or shell history. Configure stable
account IDs and absolute password-hash paths. For HTTPS use `secureCookies=true`
and the exact external `allowedOrigin`; the cookie is `__Host-rites_session`.
Insecure development cookies are separately named and restricted to explicit
loopback/test configuration.

### Forges and OAuth

Forge API and clone bases are operator-controlled, not browser-supplied URLs.
Public GitHub uses logical host `github.com`, API base `https://api.github.com`
and clone base `https://github.com`. GitLab can use its configured API prefix
and separate clone prefix on the selected host.

GitLab OAuth mode accepts an existing access/refresh pair, access expiry and an
operator-configured OAuth client. It does **not** implement a browser authorization
redirect flow. Refresh is serialized with token use; returned pairs are stored
atomically with revision/generation checks. An uncertain or rejected refresh
requires owner intervention rather than retrying a possibly consumed refresh
token. Manually replacing a pair must not be overwritten by a late response.

### Models and tool isolation

Each operator model reference has an ID, provider, model, thinking level and an
absolute private configuration-file path. The file preserves the selected
provider's actual API/compatibility/header configuration and one API-key
credential; see [worker/README.md](worker/README.md). There is no default production
model, ambient credential discovery or unconfigured-model fallback.

The trusted SDK controller receives inference credentials. Every exposed
`rites_*` tool executes through a credential-free bubblewrap runner. Coordinator
state, forge credentials and private model configuration must remain outside
all tool-visible filesystem mounts and environments, including during execution,
not merely after cleanup. Project extensions, personal agents, MCP and session
persistence are disabled.

Networking is deliberately ordinary networking: bubblewrap is not an exfiltration
or resource-quota boundary. Repository data is available to the selected model
and its repository tools. Configure only repositories/model endpoints authorized
to receive that data.

## Development and acceptance

Use the pinned shell and both locked npm trees:

```bash
nix develop .#backend --command bash -c 'cd rites && npm ci --ignore-scripts && npm run typecheck && npm test'
nix develop .#backend --command bash -c 'cd rites/web/tests && npm ci && npm test'
nix develop .#backend --command bash rites/scripts/test-postgres.sh
nix develop .#backend --command bash rites/scripts/generate.sh
nix develop .#backend --command python3 rites/scripts/check-generated.py
nix build .#checks.x86_64-linux.rites-browser .#checks.x86_64-linux.rites-backend
nix build .#checks.x86_64-linux.backend-source .#checks.x86_64-linux.backend-coassembly .#checks.x86_64-linux.rites-worker-source
```

The browser API is the single current `0.2.0` schema; the internal lockstep worker
protocol is `0.1.0`. Baboon produces Scala and TypeScript from `models/`. Scala
consumes the shared canonical Baboon runtime. The worker boundary independently
validates UTF-8 byte bounds, exact shapes, canonical UUIDs, versions and terminal
outcome consistency before using generated codecs.

A `Completed` frame alone is insufficient: the coordinator also checks run
identity, process exit and bounded output/deadlines. Completion does not establish
passing repository tests, a nonempty delta or proposal publication.

See [tests/native/README.md](tests/native/README.md) for full actual-ELF, PostgreSQL,
SDK, bubblewrap, Git/forge/OAuth fixture acceptance and the separate real-browser
native conformance leg. Scripted providers establish workflow behavior, not live
model classification quality. Controlled live tests must use synthetic content
and private external settings; never commit model identities, endpoints,
credentials or raw traces. Applicable shared/Chronicle release suites remain
required when their inputs change.
