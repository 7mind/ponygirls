# Current browser acceptance

No leg skips successfully when a required prerequisite is absent. No historical
TypeScript server is launched or imported. Fixtures seed the selected JVM/native
process using the actual generated current codecs and authenticated public API.

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

`inventory.json` is checked exactly against all 66 JUnit leaf cases (67 Node
cases including the helper-mode group), 39 main browser checks, sixteen controlled layout checks, the HTTPS
restart, preview restart, and markup case. The original 36 atomic cases remain.
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

## Viewport layout regression

The controlled-API layout fixture renders the actual App in pinned Chromium.
It checks 1440, 1101, 1100, 1024, 801, 800, 390 and 320 pixel viewports in
light/dark mode with long
unbroken titles, identifiers, projects, types, tags and modifier identities.
Page, results region and table must fit horizontally without clipping metadata;
every sort control and the open-record action is exercised by keyboard.
Accessibility snapshots retain the table, rows, column headers and cells. This is UI layout
coverage, not backend/protocol acceptance. It also runs in `test:browser`.

```sh
HAYSTACK_CHROMIUM=/absolute/pinned/chromium \
HAYSTACK_UI_ARTIFACTS=/absolute/fresh-screenshots \
nix develop .#chronicle --command bash -c 'cd haystack/web && npm run test:layout'
```
