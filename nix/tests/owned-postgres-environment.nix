# Generic fixture environment. Accessing passthru policy does NOT realize the
# rehearsal output; each test gets its own cluster and full provisioning.
{ pkgs }:
let rehearsal = import ./shared-postgres.nix { inherit pkgs; };
in {
  PG_BIN = "${pkgs.postgresql_18.withPackages (p: [ p.pgvector ])}/bin";
  PG_HBA = rehearsal.policy.hba;
  PG_POLICY = rehearsal.policy.manifest;
  # Interpolate the leaf path NOW. A raw path passed through toString loses
  # its copying context and leaves an undeclared whole-flake pathname.
  PG_PROVIDER = "${../postgres/provider.py}";
  PG_CONFIGURATION = rehearsal.policy.configuration;
}
