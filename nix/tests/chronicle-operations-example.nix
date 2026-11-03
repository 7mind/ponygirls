# Exact operations.md module example on the actual NixOS exported module. The
# host fixture supplies ordinary boot/state/ACME preconditions; no activation.
{ pkgs, nixpkgs, inputs, ponygirls }:
let
  lib=pkgs.lib;
  fixture=./fixtures/chronicle-operations-nixos.nix;
  cfg=(nixpkgs.lib.nixosSystem {
    system=pkgs.stdenv.hostPlatform.system;
    specialArgs={inputs=inputs//{inherit ponygirls;};};
    modules=[fixture {
      system.stateVersion="26.11";
      boot.loader.grub.enable=false;
      fileSystems."/"={device="none";fsType="tmpfs";};
      security.acme={acceptTerms=true;defaults.email="fixture@example.test";certs."chronicle.example.net"={group="nginx";webroot="/var/lib/acme/acme-challenge";};};
    }];
  }).config;
in
assert lib.assertMsg (lib.all (a: a.assertion) cfg.assertions) (lib.concatStringsSep "\n" (map (a: a.message) (lib.filter (a: !a.assertion) cfg.assertions)));
assert cfg.services.postgresql.enable && cfg.services.postgresql.dataDir=="/var/lib/ponygirls-postgres-18/data";
assert !(cfg.systemd.services?ponygirls-postgres);
assert cfg.smind.services.chronicle.database.jdbcUrl=="jdbc:postgresql://127.0.0.1:15434/chronicle";
assert cfg.smind.services.chronicle.database.limits.lockTimeoutMs==35000;
assert cfg.smind.services.chronicle.database.limits.idleTransactionTimeoutMs==60000;
assert cfg.smind.services.chronicle.database.limits.socketTimeoutMs==35000;
assert cfg.ponygirls.servicePostgres.databases.chronicle.lockTimeoutMs==35000;
assert cfg.ponygirls.servicePostgres.databases.chronicle.idleTransactionTimeoutMs==60000;
assert cfg.systemd.services.chronicle-migrate.requires==["ponygirls-database-chronicle.service"];
assert cfg.systemd.services.chronicle.requires==["chronicle-migrate.service"];
assert cfg.services.postgresql.settings.listen_addresses=="127.0.0.1";
pkgs.runCommand "chronicle-operations-nixos-consumer-example" {} ''
  mkdir "$out"
  cp ${fixture} "$out/example.nix"
  printf '%s\n' '${builtins.hashString "sha256" (builtins.readFile fixture)}' > "$out/snippet.sha256"
  printf '%s\n' 'Exact operations example: all NixOS assertions plus shared provider/connection/35s-lock60s-idle/migration graph evaluated; fixture supplies boot/state and the selected external ACME certificate. No activation, credential reads or service-runtime claim.' > "$out/scope"
''
