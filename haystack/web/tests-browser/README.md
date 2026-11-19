# Current browser acceptance

No leg skips successfully when a required prerequisite is absent. No historical
TypeScript server is launched or imported. Fixtures seed the selected JVM/native
process using the actual generated current codecs and authenticated public API.
Browser sign-in uses a synthetic username/password and paired passwordHashFile;
the API seed token is never installed as a browser cookie. The preview restart
leg retains its owned private PostgreSQL database to prove session and edited
record durability, not merely credential-file persistence. Controlled process-stub
and owned-file tests separately check failed-start stop authority, retained
shutdown guards, exclusive test-directory ownership and namespace-link refusal;
those checks are not PostgreSQL/backend acceptance.

Run from the repository root inside the pinned shell (provision the locked npm
cache first if needed; the runner's `npm ci --offline` never changes the lock):

```sh
HAYSTACK_ARTIFACT_KIND=jvm \
HAYSTACK_SERVER_ARTIFACT_FILE=/absolute/haystack-server.jar \
HAYSTACK_SERVER_COMMAND='java -jar /absolute/haystack-server.jar' \
HAYSTACK_CHROMIUM=/absolute/pinned/chromium \
HAYSTACK_NGINX=/absolute/pinned/nginx \
HAYSTACK_REPORT_DIR=/absolute/fresh-report \
nix develop .#chronicle --command bash haystack/scripts/test-browser.sh
```

For native acceptance set `HAYSTACK_ARTIFACT_KIND=native`, provide the exact ELF
in `HAYSTACK_SERVER_ARTIFACT_FILE`, and select that executable with
`HAYSTACK_SERVER_COMMAND`. JVM results are not native behavioral acceptance.

The runner needs pinned Node/npm, PostgreSQL (including pgvector), Python 3,
Bash, timeout, curl, Nix, OpenSSL, Chromium and nginx. It bounds the **whole** job
to 575 seconds plus a ten-second termination grace; individual assertion,
heartbeat, concurrency and restart deadlines are unchanged. Use the parent's
background execution lane rather than extending foreground tool timeouts.

`inventory.json` is checked exactly against all 81 JUnit leaf cases (82 Node
cases including the helper-mode group), 39 main browser checks, sixteen controlled
layout checks, the controlled account fixture, five shell checks, HTTPS restart,
preview restart, and markup case. The original 36 atomic cases remain.
A fresh report records source and inventory hashes, dependency identities,
JAR/ELF SHA256 before and after, complete logs, XML, and a zero-skip receipt.
Failed/missing case inventories fail the runner; existing reports are never
reused or overwritten.

## Optional paired provisioning helper

`HAYSTACK_TEST_PROVISION_COMMAND=/absolute/executable` is the same fixture
protocol as `server/tests-current/fixture.mjs`:

- Provision: argv `["haystack_current_<16 lowercase hex digits>"]`.
- Stdout: exactly `{ "jdbcUrl": "jdbc:postgresql://127.0.0.1:PORT/NAME",
  "user": "runtime-role", "passwordFile": "/absolute/nonempty-file" }`.
  `localhost` and `[::1]` are also accepted. The database name must match the
  generated argument. No credentials, query options or fragments in the URL.
- Cleanup: argv `["--drop", "NAME"]`, stdout exactly `{}`. Only the registered,
  harness-generated name is cleaned, including after failed provisioning.
- Each invocation has a real ten-second deadline and 16-KiB output ceiling;
  JSON, UTF-8, descriptor and credential-file checks fail closed. A configured
  helper's failure **never** falls back to the administrator or runtime user.

The owned-cluster runner provides `HAYSTACK_OWNED_TEST_DB=1`,
`HAYSTACK_TEST_JDBC`, `HAYSTACK_TEST_DB_USER`,
`HAYSTACK_TEST_DB_PASSWORD_FILE`, `HAYSTACK_FIXTURE_WORK_DIR`,
`HAYSTACK_OWNED_PGDATA`, and `HAYSTACK_TEST_PG` for the helper's explicit admin
lane. The helper should install `vector` administratively before returning a
least-privilege runtime descriptor. `configFor` receives only that returned
runtime descriptor, not the administrator connection or password.

Without a helper, direct `CREATE DATABASE` requires
`HAYSTACK_FIXTURE_ADMIN_AUTHORIZED=1`. The runner grants this only for its own
disposable loopback cluster. Direct manual harness invocations must provide
that authorization explicitly; supplying a connection URL alone is insufficient.
The preview owns a separate disposable cluster and installs the extension as
administrator before starting a NOSUPERUSER/NOCREATEDB/NOCREATEROLE runtime.

## Actual NixOS proxy input (filtered source builds)

Set `HAYSTACK_PROXY_CONFIG_FILE=/absolute/evaluated-proxy.json` to consume JSON
from the **actual evaluated NixOS module**, with exactly this shape:

```json
{
  "backendPort": 15433,
  "publicUrl": "https://127.0.0.1:15434",
  "root": "/nix/store/ACTUAL-package-assets",
  "locations": {
    "/api/": {"proxyPass":"http://127.0.0.1:15433/api/","proxyWebsockets":true,"tryFiles":null,"extraConfig":"ACTUAL module value"}
  }
}
```

This is a shape illustration, **not** a proxy fixture or substitute policy. The
producer must export all actual locations and their selected fields. The
consumer uses declared loopback ports and origin, requires every `proxyPass` to
match that backend port, and serves `root` unchanged (nullable; no substitution
with local `web/dist`). Non-null roots must contain the actual `index.html`.
Malformed or missing configured files fail closed: no Nix/Git evaluation or
fallback runs. The exact file is copied and SHA256-bound before/after acceptance.
Only the current generated direct `Failure` codec is accepted for gateway errors.

Without this variable, the ordinary Git-checkout path evaluates the actual
module with explicit external database consumer fields (`jdbcUrl`, `user`,
`passwordFile`, `readinessUnit = null`). It is not a canned proxy template.

Filtered Nix sources need no `.git`, fake Git stub or Nix executable when the
JSON is supplied. Set `HAYSTACK_SOURCE_REVISION` to the real 40-hex source commit
identity when `.git` is absent; full source-file hashes remain the binding, not
the label alone. The native/JAR artifact remains independently SHA256-bound.

On a non-isolated host the producer must select unused declared ports. Before
launch, the harness bind-checks both backend and proxy ports and refuses occupied
listeners without sending requests. Backend health checks begin only after its
own selected child emits the exact `haystack: ready` marker; an unrelated healthy
service cannot satisfy fixture readiness. Private Nix-network fixed ports remain
valid without changing the evaluated JSON.

## Controlled account integration

`npm run test:account` uses the real React app and shared account assets with
owned HTTP fixtures that answer only the five existing account endpoints (the
module's degraded mode). It checks username/password sign-in, distinct
invalid-login and outage feedback, independent HttpOnly cookies, the Access tokens
page in the account outlet over the kept list, configured-token immutability,
create/reveal/copy/"I have saved it"/revoke through in-app dialogs, secret-free web
storage, an identity change observed by the module, and module-owned sign-out at
1440 and 1024 pixels in both themes (the shared account page has no phone layout
yet). It does not establish backend account authorization or persistence.
The default assets are `shared/account-web`; an explicit absolute
`HAYSTACK_ACCOUNT_WEB_ROOT` can select another task worktree for integration
checks. The fixture records the three asset SHA-256 digests without secrets.

## Shell

`node tests-browser/shell.mjs` serves the built `web/dist` and drives it in pinned
Chromium against page-routed API responses and a routed live socket (no backend):
the five preset routes and record/edit routes with a state-preserving Back,
the masthead at 1440, 1024 and 390 pixels in both themes, live changes on scrolled
and untouched lists, which searches a route keeps (only settled ones), the account
outlet over a kept list and module-owned sign-out, and no native dialogs. Needs `HAYSTACK_CHROMIUM` and a prior `npm run build`.

## Browse

`node --import ../scripts/register-generated.mjs tests-browser/browse.mjs` starts the selected server
(`HAYSTACK_SERVER_COMMAND`) with its own owned database (`HAYSTACK_TEST_PG` with
`HAYSTACK_FIXTURE_ADMIN_AUTHORIZED=1`, or `HAYSTACK_TEST_PROVISION_COMMAND`), seeds records through the public
API and drives the built `web/dist` in pinned Chromium: the document as the only scroller with the sticky view bar
and table header, sorting, infinite loading to an explicit end marker, append failure and retry, legacy URL
migration, Back from a record, live-change announcement, Search of the applied query as the list's refresh (also
at the address without a fragment; a "No changes" toast when nothing changed, also at 390 px), the query editor
(filter shortcuts, completions, draft versus applied query, analyzer rejection) and no native dialogs. Fault and timing scenarios use page routes and
Playwright's clock.

## Viewport layout regression

The controlled-API layout fixture renders the actual App in pinned Chromium at 1440, 1024 and 390 pixels in
light and dark with long unbroken titles, identifiers, projects, types, tags and modifier identities: no
horizontal overflow, the table stays a table (Project and Rev hide at 1100 px, all but Record and Modified at
720 px) with unclipped headers, every truncated value is available as a tooltip, visible text is at least 12 px
with 4.5:1 contrast, and every visible sort control, the skip link and the open-record action work by keyboard.
Account identity changes refresh the principal, update the account outlet's owner and invalidate stale account
state; the uncertain-write recovery fits 320 pixels. The masthead is covered by the shell checks. This is UI
layout coverage, not backend/protocol acceptance. It also runs in `test:browser`.

```sh
HAYSTACK_CHROMIUM=/absolute/pinned/chromium \
nix develop .#chronicle --command bash -c 'cd haystack/web && npm run test:layout'
```
