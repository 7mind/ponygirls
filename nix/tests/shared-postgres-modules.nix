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
  tuned = hm { ponygirls.servicePostgres = { sharedBuffers = "16GB"; effectiveCacheSize = "128GB"; maintenanceWorkMem = "1GB"; trackIoTiming = true; randomPageCost = 1.1; effectiveIoConcurrency = 200; maintenanceIoConcurrency = 100; }; };
  tunedPolicy = import ../postgres/policy.nix { inherit lib pkgs; cfg = tuned.ponygirls.servicePostgres; };
  hyphenAdmin = hm { home.username = "pavel-shirshov"; };
  hyphenPolicy = import ../postgres/policy.nix { inherit lib pkgs; cfg = hyphenAdmin.ponygirls.servicePostgres; };
  overBudget = hm { ponygirls.servicePostgres.maxConnections = 32; };
  systemEvaluation = nixpkgs.lib.nixosSystem {
    system = pkgs.stdenv.hostPlatform.system;
    modules = [ ../nixos/service-postgres.nix {
      system.stateVersion = "26.11";
      ponygirls.servicePostgres = { enable = true; inherit databases; };
      boot.loader.grub.enable = false;
      fileSystems."/" = { device = "none"; fsType = "tmpfs"; };
    } ];
  };
  system = systemEvaluation.config;
  withExtraAperture = (systemEvaluation.extendModules { modules=[{
    systemd.services.postgresql.serviceConfig.ReadWritePaths=["/srv/operator-extra"];
  }]; }).config;
  invalidAperture = (systemEvaluation.extendModules { modules=[{
    systemd.services.postgresql.serviceConfig.ReadWritePaths=lib.mkForce "/srv/not-a-list";
  }]; }).config;
  longKey = lib.concatStrings (lib.genList (_: "a") 65);
  longKeySystem = (systemEvaluation.extendModules { modules=[{
    ponygirls.servicePostgres.databases=lib.mkForce {
      "${longKey}"={name="short_db";user="short_role";passwordFile="/run/secrets/long-key-database";};
    };
  }]; }).config;
  hmUnits = base.systemd.user.services;
  dbNames = map (name: "ponygirls-database-${name}") (builtins.attrNames databases);
in
assert lib.all (a: a.assertion) base.assertions;
assert !(lib.all (a: a.assertion) overBudget.assertions);
assert lib.all (a: a.assertion) hyphenAdmin.assertions;
assert lib.hasInfix ''local all "pavel-shirshov" peer'' hyphenPolicy.hbaText;
assert builtins.attrNames hmUnits == [ "ponygirls-database-chronicle" "ponygirls-database-haystack" "ponygirls-database-manure" "ponygirls-postgres" ];
assert lib.all (name: hmUnits.${name}.Unit.Requires == [ "ponygirls-postgres.service" ]) dbNames;
assert !(hmUnits.ponygirls-postgres.Unit ? PartOf);
assert hmUnits.ponygirls-postgres == disabledApp.systemd.user.services.ponygirls-postgres;
assert hmUnits.ponygirls-database-chronicle == disabledApp.systemd.user.services.ponygirls-database-chronicle;
assert base.ponygirls.servicePostgres.databases.chronicle.lockTimeoutMs == 35000;
assert base.ponygirls.servicePostgres.databases.chronicle.idleTransactionTimeoutMs == 60000;
assert base.ponygirls.servicePostgres.databases.haystack.lockTimeoutMs == 5000;
assert base.ponygirls.servicePostgres.databases.manure.idleTransactionTimeoutMs == 30000;
assert base.ponygirls.servicePostgres.connections.haystack.jdbcUrl == "jdbc:postgresql://127.0.0.1:15434/haystack";
assert tunedPolicy.settings.shared_buffers == "16GB";
assert tunedPolicy.settings.effective_cache_size == "128GB";
assert tunedPolicy.settings.maintenance_work_mem == "1GB";
assert tunedPolicy.settings.track_io_timing;
assert tunedPolicy.settings.random_page_cost == 1.1;
assert tunedPolicy.settings.effective_io_concurrency == 200;
assert tunedPolicy.settings.maintenance_io_concurrency == 100;
assert system.services.postgresql.settings.hba_file != toString (import ../postgres/policy.nix { inherit lib pkgs; cfg = system.ponygirls.servicePostgres; }).hba;
assert lib.hasInfix ''local all "postgres" peer'' system.services.postgresql.authentication;
assert system.services.postgresql.settings.listen_addresses == "127.0.0.1";
assert system.services.postgresql.enable;
assert lib.all (a: a.assertion) longKeySystem.assertions;
assert builtins.hasAttr "ponygirls-database-${longKey}" longKeySystem.systemd.services;
assert system.services.postgresql.dataDir == "/var/lib/ponygirls-postgres-18/data";
assert system.systemd.services.postgresql-setup.environment.PGHOST == "/var/lib/ponygirls-postgres-18/socket";
assert system.systemd.services.postgresql.serviceConfig.ReadWritePaths == ["/var/lib/ponygirls-postgres-18"];
assert withExtraAperture.systemd.services.postgresql.serviceConfig.ReadWritePaths == ["/var/lib/ponygirls-postgres-18" "/srv/operator-extra"];
assert withExtraAperture.systemd.services.postgresql.serviceConfig.ProtectSystem == "strict";
assert withExtraAperture.systemd.services.postgresql.serviceConfig.User == "postgres";
assert !(builtins.tryEval invalidAperture.systemd.services.postgresql.serviceConfig.ReadWritePaths).success;
assert !(system.systemd.services ? ponygirls-postgres);
assert system.systemd.services.ponygirls-database-haystack.requires == [ "postgresql.service" ];
assert system.services.postgresql.settings.fsync;
assert system.services.postgresql.settings.full_page_writes;
assert system.services.postgresql.settings.synchronous_commit == "on";
pkgs.runCommand "shared-postgres-module-adapters" { } ''
  test -f ${system.services.postgresql.finalPackage}/share/postgresql/extension/vector.control
  mkdir "$out"
  printf '%s\n' 'HM: exactly one daemon + 3 database units; independent application package change leaves provider/unrelated database unit unchanged. NixOS: existing sole postgresql.service adapter. No activation/runtime-systemd claim.' > "$out/scope"
''
