# Actual Home Manager user-manager lifecycle fixture

This separate owned VM uses the real Home Manager NixOS integration resolved
from the existing nixpkgs-pinned `pkgs.home-manager.src` URL/NAR hash. No new input
or pin is introduced. Actual exported Chronicle/agentic HM modules generate the
user units, database/configuration paths and migration chains for a lingering
`alice` UID1000 user manager. No system PostgreSQL service is enabled.

Only app CLI packages are explicitly synthetic, as in the NixOS lifecycle gate:
real PostgreSQL 18/pgvector, SCRAM app roles, current generated database connection
configuration and same-live-invocation SQL probes are used. No HTTP/model server
is simulated or claimed. Unrelated crawler/search/proxy unit definitions remain
real but their default-target activation is disabled in this fixture. Their
runtime behavior is not claimed.

Seven mandatory cells cover initial three apps/one user provider, own-app restart
isolation, explicit provider restart, crash/autorestart with fresh journal-cursor
and live-invocation SQL evidence, stopped-consumer preservation, deliberate
manual stop/start of selected chains, and an actual module-disable configuration
switch. All commands target the guest user manager via guest UID1000 runtime
bus; no host systemd/HOME/configuration is accessed or activated. Synthetic
credential fixtures are private guest-only files. HM's common-UID boundary is
explicit: PG role ACLs do not isolate credentials from another same-UID process.

The VM has no host store/cert/dir/socket sharing, bridge/TAP or SSH backdoor. Its
writable store is a guest tmpfs overlay over an isolated read-only EROFS image,
not a host mount. This is needed for real guest configuration activation and
registration. The required feature is honest `nixos-test`, with real TCG fallback.

Preparation/evaluation is not runtime acceptance. Only the parent may launch the
frozen VM through the supervised background runner. Terminal receipts retain all
seven cells, failed bootstrap/restore attribution and not-executed inventory.
