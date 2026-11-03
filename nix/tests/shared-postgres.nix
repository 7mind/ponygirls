# Behavioral-Active / Effectual-GoodCommunication; disposable real provider.
{ pkgs }:
let
  cfg = {
    package = pkgs.postgresql_18.withPackages (p: [ p.pgvector ]);
    stateDirectory = "/unused-evaluation-path";
    adminRole = "nixbld";
    port = 15434;
    maxConnections = 64;
    adminReserve = 8;
    sharedBuffers = "128MB";
    effectiveCacheSize = "4GB";
    maintenanceWorkMem = "64MB";
    trackIoTiming = false;
    randomPageCost = 4.0;
    effectiveIoConcurrency = 1;
    maintenanceIoConcurrency = 10;
    databases = builtins.listToAttrs (map (name: { inherit name; value = {
      inherit name;
      user = name;
      schemas = if name == "manure" then [ "public" "manure" ] else [ "public" ];
      passwordFile = "/unused/${name}";
      createPassword = true;
      maxConnections = 12;
      statementTimeoutMs = 1000;
      lockTimeoutMs = 250;
      idleTransactionTimeoutMs = 1000;
      workMem = "4MB";
    }; }) [ "haystack" "manure" "chronicle" ]);
  };
  policy = import ../postgres/policy.nix { inherit (pkgs) lib; inherit pkgs cfg; };
in pkgs.runCommand "shared-postgresql-18-provider-rehearsal" {
  nativeBuildInputs = [ pkgs.python3 cfg.package pkgs.coreutils ];
  passthru = { inherit policy; };
} ''
  export PG_BIN=${cfg.package}/bin
  export PG_HBA=${policy.hba}
  export PG_POLICY=${policy.manifest}
  export PG_PROVIDER=${../postgres/provider.py}
  export PG_BACKUP_TOOL=${../postgres/backup.py}
  export PG_OFFLINE_TOOL=${../../manure/migration/offline.py}
  export PG_CONFIGURATION=${policy.configuration}
  mkdir -p "$out"
  python3 ${./provider-files-test.py} ${../postgres/provider.py} "$out/credential-boundaries.json"
  python3 ${./provider-admin-test.py} "$out/hyphen-admin.json"
  python3 ${./shared-postgres-test.py} --output "$out"
''
