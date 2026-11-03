# Actual module lifecycle baseline

`checks.x86_64-linux.service-unit-graph-vm` exercises the **exported NixOS
modules**, generated unit dependencies/configuration/credentials, stock sole
`postgresql.service`, actual PostgreSQL 18/pgvector and non-superuser app roles.
All state is inside an owned VM. No host activation, host store/directory/socket
sharing, bridge/TAP or production connection is accepted.

The package option is overridden by an explicitly synthetic test CLI. It reads
the actual generated connection configuration, authenticates, checks finite
least-privileged role/extension prerequisites, and exposes SQL reconnect evidence
via a test-only process signal. It implements **no application HTTP API**, model,
backend or protocol. Native application, migration semantics, auth, files and
browser behavior require their separate real-service gates. This VM establishes
NixOS lifecycle semantics, not HM runtime acceptance.

The positive inventory has nine cases: initial three consumers/readiness,
consumer restart isolation, deliberate provider restart, crash/autorestart,
intentionally stopped consumer, manual stop/start, migration restart isolation,
actual package-specialisation switch, and actual disabled-consumer module switch.
PID, monotonic activation time, invocation ID and journal activation counts are
observed. SQL probes execute in the running synthetic service processes using
their loaded credentials. SQL/password values are not emitted.

The baseline is run **before** any dependency-policy edit. It can disprove an
assumed defect; a green baseline is not grounds for an unnecessary `PartOf` fix.
Manual stop/start is deliberately distinguished from restart: stop leaves apps
down; starting the provider alone must not resurrect them; explicitly starting
selected consumers restores their own chains. This proposed explicit-operator
manual-stop policy is recorded in the receipt, not inferred from `PartOf`.

`lifecycle-receipt.json` records every case (including red ones), typed before/
after state and zero skips. The source manifest is retained. A failed matrix
exits nonzero; no production dependency patch is included with this test.
Build/run only through the parent's supervised background lane.
