# Actual three-service module composition/restart graph; pure evaluation, no live
# systemd or host activation claim. No fake provider or duplicated provider path.
{ pkgs, nixpkgs, inputs }:
let
  lib=pkgs.lib;
  factory = { pkgs }: pkgs.hello;
  databases = lib.genAttrs [ "haystack" "manure" "chronicle" ] (name: {
    passwordFile = "/run/secrets/${name}-database";
    schemas = if name=="manure" then [ "public" "manure" ] else [ "public" ];
  });
  connections = service: { jdbcUrl = "jdbc:postgresql://127.0.0.1:15434/${service}"; user=service; passwordFile="/run/secrets/${service}-database"; readinessUnit="ponygirls-database-${service}.service"; };
  hm = extra: (lib.evalModules {
    specialArgs={ inherit pkgs; };
    modules=[ ./user-services-stub.nix ./agentic-services-legacy-config.nix
      (import ../hm/agentic-services-server.nix { inherit inputs; })
      (import ../hm/chronicle-server.nix { mkChroniclePackage=factory; })
      {
        ponygirls.servicePostgres={ enable=true; inherit databases; };
        smind.hm.services.agentic.haystack.database=connections "haystack";
        smind.hm.services.agentic.manure.database=connections "manure";
        smind.hm.services.chronicle={ enable=true; package=pkgs.hello;
          database={ passwordFile="/run/secrets/chronicle-database"; port=15434; readinessUnit="ponygirls-database-chronicle.service"; };
          serverDependencies=[ "embedding.service" ];
          settings={ listenHost="127.0.0.1"; listenPort=47330; maxBodyBytes=8388608; allowedOrigin="https://chronicle.example.net"; };
        };
        systemd.user.services.embedding.Service.ExecStart="/example/model-server";
      } extra ];
  }).config;
  base=hm {};
  disabled=hm { smind.hm.services.agentic.haystack.enable=lib.mkForce false; smind.hm.services.agentic.manure.enable=lib.mkForce false; smind.hm.services.chronicle.enable=lib.mkForce false; };
  changed=hm { smind.hm.services.agentic.haystack.package=lib.mkForce pkgs.coreutils; };
  serviceUnits=base.systemd.user.services;
  sameUnit = unit: serviceUnits.${unit}==changed.systemd.user.services.${unit};
  system=(nixpkgs.lib.nixosSystem {
    system=pkgs.stdenv.hostPlatform.system;
    modules=[
      (import ../nixos/haystack.nix { mkHaystackPackage=factory; })
      (import ../nixos/manure.nix { mkManurePackage=factory; })
      (import ../nixos/chronicle.nix { mkChroniclePackage=factory; })
      {
        system.stateVersion="26.11";
        ponygirls.servicePostgres={ enable=true; inherit databases; };
        smind.services.haystack={ enable=true; database=connections "haystack"; users.operator={type="human";tokens.main.tokenHashFile="/run/secrets/haystack-sha256";}; proxy.enable=false; };
        smind.services.manure={ enable=true; database=connections "manure"; users.operator={type="human";tokens.main.tokenHashFile="/run/secrets/manure-sha256";}; apiOrigin="https://manure.example.net"; contentSuffix="files.example.net"; proxy.enable=false; };
        smind.services.chronicle={ enable=true; database=connections "chronicle"; publicUrl="https://chronicle.example.net"; users.operator={login="operator";passwordHashFile="/run/secrets/chronicle-user";}; proxy.enable=false;
          annotation={ endpoint="http://127.0.0.1:8080/chat";model="annotation";revision="fixture-v1";credentialFile="/run/secrets/annotation";requestPolicy="strict-json-schema"; };
          embedding={ endpoint="http://127.0.0.1:8081/embed";model="embedding";revision="fixture-v1";credentialFile="/run/secrets/embedding";dimensions=384;queryPrefix="";documentPrefix=""; };
        };
      }
    ];
  }).config;
in
assert lib.all (a: a.assertion) base.assertions;
assert lib.filter (name: lib.hasSuffix "-postgres" name) (builtins.attrNames serviceUnits)==["ponygirls-postgres"];
assert !(serviceUnits?ivm-postgres) && !(serviceUnits?chronicle-postgres);
assert sameUnit "ponygirls-postgres" && sameUnit "ponygirls-database-manure" && sameUnit "ivm-manure" && sameUnit "chronicle";
assert serviceUnits.ponygirls-postgres==disabled.systemd.user.services.ponygirls-postgres;
assert lib.all (name: serviceUnits."ponygirls-database-${name}"==disabled.systemd.user.services."ponygirls-database-${name}") ["haystack" "manure" "chronicle"];
assert serviceUnits.ivm-haystack.Unit.Requires==["ivm-haystack-migrate.service"];
assert serviceUnits.ivm-manure.Unit.Requires==["ivm-manure-migrate.service"];
assert serviceUnits.chronicle-migrate.Unit.Requires==["ponygirls-database-chronicle.service"];
assert !(builtins.elem "embedding.service" serviceUnits.chronicle-migrate.Unit.After);
assert !(serviceUnits.ponygirls-postgres.Unit?PartOf);
assert system.services.postgresql.enable;
# Actual stock custom-dataDir hardening mounts before ExecStartPre. Only the
# existing managed root can be mandatory; init itself must create absent data
# and its marker/socket without adopting an unmarked preexisting directory.
assert system.systemd.services.postgresql.serviceConfig.ReadWritePaths==[system.ponygirls.servicePostgres.stateDirectory];
assert system.systemd.services.postgresql.serviceConfig.ProtectSystem=="strict";
assert !(builtins.any (rule: lib.hasPrefix "d ${system.ponygirls.servicePostgres.stateDirectory}/data " rule) system.systemd.tmpfiles.rules);
assert !(system.systemd.services?ponygirls-postgres);
assert system.systemd.services.haystack-setup.requires==["ponygirls-database-haystack.service"];
assert system.systemd.services.manure-migrate.requires==["ponygirls-database-manure.service"];
assert system.systemd.services.chronicle-migrate.requires==["ponygirls-database-chronicle.service"];
assert system.systemd.services.manure.requires==["manure-migrate.service"];
assert system.systemd.services.chronicle.requires==["chronicle-migrate.service"];
# Manure IOApp TERM may return 143 after its shutdown hooks; these serve-only
# declarations must not relax migrations or SIGKILL/fatal exits.
assert serviceUnits.ivm-manure.Service.SuccessExitStatus==[143];
assert system.systemd.services.manure.serviceConfig.SuccessExitStatus==[143];
assert !(serviceUnits.ivm-manure-migrate.Service?SuccessExitStatus);
assert !(system.systemd.services.manure-migrate.serviceConfig?SuccessExitStatus);
assert lib.all (status: !(builtins.elem status serviceUnits.ivm-manure.Service.SuccessExitStatus)) [1 137 "SIGKILL"];
assert lib.all (status: !(builtins.elem status system.systemd.services.manure.serviceConfig.SuccessExitStatus)) [1 137 "SIGKILL"];
assert !(serviceUnits.ivm-haystack.Service?SuccessExitStatus);
assert !(system.systemd.services.haystack.serviceConfig?SuccessExitStatus);
# Separately reproduced on the actual Chronicle native PID + pinned classifier.
assert system.systemd.services.chronicle.serviceConfig.SuccessExitStatus==[143];
assert !(system.systemd.services.chronicle-migrate.serviceConfig?SuccessExitStatus);
assert lib.all (status: !(builtins.elem status system.systemd.services.chronicle.serviceConfig.SuccessExitStatus)) [1 137 "SIGKILL"];
assert !(serviceUnits.chronicle-migrate.Service?SuccessExitStatus);
assert serviceUnits.chronicle.Service.SuccessExitStatus==[143]; # Preexisting Chronicle HM policy remains unchanged.
pkgs.runCommand "shared-three-service-provider-module-composition" {} ''
  mkdir "$out"
  printf '%s\n' 'Actual HM+NixOS three-service modules: one provider, independent database/migration units, model-independent migrations, app-disable/provider retention and unrelated-package restart identity.' > "$out/scope"
''
