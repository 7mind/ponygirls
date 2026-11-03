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
selected consumers restores their own chains. This root-approved explicit-operator
manual-stop policy is recorded in the receipt, not inferred from `PartOf`.

`lifecycle-receipt.json` records every mandatory case, typed before/after and
restored state, precondition/fault/post-observation/restore phases, invalid-fixture
classification and explicit not-executed inventory. Bootstrap/observation/restore
failures cannot masquerade as Requires regressions or zero-skip completion. The source manifest is retained. A failed matrix
exits nonzero; no production dependency patch is included with this test.
Build/run only through the parent's supervised background lane.

Readiness installs the adapter's signal handler **before** its ready event.
Reconnect success must be fresh evidence from the active, same intended systemd
invocation, never an aggregate event from a dead/replaced process. Fifteen
controlled actual-adapter/driver regressions gate these rules separately.

The pinned framework defaults `requiredFeatures.kvm=true` independently of
`qemu.forceAccel=false`. The fixture explicitly selects the documented
`requiredFeatures.kvm=false` emulated-execution capability and retains the real
QEMU TCG fallback. Required features are exactly `nixos-test`; neither the host's
features nor its configuration are changed. Guest execution remains mandatory.

The original37d runtime matrix established all-three boot, isolated app restart,
explicit provider restart and current-invocation role SQL recovery. Its red crash
metric was `NRestarts` resetting after stock `postgresql.target` restarts; fresh
`SD_MESSAGE_UNIT_RESTART_SCHEDULED` evidence is now captured after a pre-fault
journal cursor, matched to the exact provider/current boot, alongside new PID,
invocation/start count and all three fresh role probes. Manual selected recovery
requires exactly its two selected DB/migrate/app chains while explicitly keeping
the unselected whole chain inactive; ordinary all-ready still checks all three.

Guest configuration switches require a writable **guest-only tmpfs overlay**
over the isolated read-only EROFS store image. Host store mounting remains false
and host sharing remains empty. This fixes actual `register-nix-paths` read-only
`.links` activation failures rather than ignoring exit4 or skipping the real
package/module switch and baseline restoration assertions.
