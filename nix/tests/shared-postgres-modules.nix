# Behavioral-Active/Effectual-Group; actual provider adapters, not text grep.
{ pkgs, nixpkgs }:
let
  lib = pkgs.lib;
  databases = builtins.listToAttrs (map (name: { inherit name; value.passwordFile = "/run/secrets/${name}-database"; }) [ "haystack" "manure" "chronicle" ]);
  hm = extra: (lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [ ./user-services-stub.nix ../hm/service-postgres.nix {
      ponygirls.servicePostgres = { enable = true; inherit databases; };
    } extra ];
  }).config;
  base = hm { };
  disabledApp = hm { systemd.user.services.haystack.Service.ExecStart = "/example/other-package/haystack-server"; };
  overBudget = hm { ponygirls.servicePostgres.maxConnections = 32; };
  system = (nixpkgs.lib.nixosSystem {
    system = pkgs.stdenv.hostPlatform.system;
    modules = [ ../nixos/service-postgres.nix {
      system.stateVersion = "26.11";
      ponygirls.servicePostgres = { enable = true; inherit databases; };
      boot.loader.grub.enable = false;
      fileSystems."/" = { device = "none"; fsType = "tmpfs"; };
    } ];
  }).config;
  hmUnits = base.systemd.user.services;
  dbNames = map (name: "ponygirls-database-${name}") (builtins.attrNames databases);
in
assert lib.all (a: a.assertion) base.assertions;
assert !(lib.all (a: a.assertion) overBudget.assertions);
assert builtins.attrNames hmUnits == [ "ponygirls-database-chronicle" "ponygirls-database-haystack" "ponygirls-database-manure" "ponygirls-postgres" ];
assert lib.all (name: hmUnits.${name}.Unit.Requires == [ "ponygirls-postgres.service" ]) dbNames;
assert !(hmUnits.ponygirls-postgres.Unit ? PartOf);
assert hmUnits.ponygirls-postgres == disabledApp.systemd.user.services.ponygirls-postgres;
assert hmUnits.ponygirls-database-chronicle == disabledApp.systemd.user.services.ponygirls-database-chronicle;
assert base.ponygirls.servicePostgres.connections.haystack.jdbcUrl == "jdbc:postgresql://127.0.0.1:15434/haystack";
assert system.services.postgresql.enable;
assert system.services.postgresql.dataDir == "/var/lib/ponygirls-postgres-18/data";
assert !(system.systemd.services ? ponygirls-postgres);
assert system.systemd.services.ponygirls-database-haystack.requires == [ "postgresql.service" ];
assert system.services.postgresql.settings.fsync;
assert system.services.postgresql.settings.full_page_writes;
assert system.services.postgresql.settings.synchronous_commit == "on";
pkgs.runCommand "shared-postgres-module-adapters" { } ''
  mkdir "$out"
  printf '%s\n' 'HM: exactly one daemon + 3 database units; independent application package change leaves provider/unrelated database unit unchanged. NixOS: existing sole postgresql.service adapter. No activation/runtime-systemd claim.' > "$out/scope"
''
