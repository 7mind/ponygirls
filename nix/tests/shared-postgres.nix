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
    databases = builtins.listToAttrs (map (name: { inherit name; value = {
      inherit name;
      user = name;
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
  export PG_CONFIGURATION=${policy.configuration}
  mkdir -p "$out"
  python3 ${./shared-postgres-test.py} --output "$out"
''
