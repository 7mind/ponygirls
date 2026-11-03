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

`inventory.json` is checked exactly against all 56 JUnit leaf cases (57 Node
cases including the helper-mode group), 34 main browser checks, the HTTPS
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
