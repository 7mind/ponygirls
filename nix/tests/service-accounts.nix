# Specified Behavioral-Active Blackbox-Group configuration contracts, with an
# Effectual-GoodCommunication leg for systemd credential materialization.
{ pkgs, nixpkgs, inputs }:
let
  inherit (pkgs) lib;
  factory = { pkgs }: pkgs.hello;
  manureStub = pkgs.writeShellScriptBin "manure-server" ''
    test "$#" = 2
    cp "$2" "$CAPTURE_CONFIG"
  '';
  stubs = { lib, ... }: {
    options = {
      assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
      services.postgresql = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
      services.nginx = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
      networking.firewall.allowedTCPPorts = lib.mkOption { type = lib.types.listOf lib.types.port; default = [ ]; };
      systemd.services = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
      systemd.tmpfiles.rules = lib.mkOption { type = lib.types.listOf lib.types.str; default = [ ]; };
      users.users = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
      users.groups = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
    };
  };
  users = {
    alice = {
      type = "human";
      displayName = "Alice";
      login = "alice";
      passwordHashFile = "/run/secrets/alice-pbkdf2";
      tokens.configured.tokenHashFile = "/run/secrets/alice-api-sha256";
    };
    password-only = {
      type = "human";
      login = "password-only";
      passwordHashFile = "/run/secrets/password-only-pbkdf2";
    };
    retired = {
      type = "human";
      enabled = false;
      tokens.retained.tokenHashFile = "/run/secrets/retired-sha256";
    };
    agent = { type = "agent"; tokens.default.tokenHashFile = "/run/secrets/agent-sha256"; };
  };
  system = name: extra: (lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      (if name == "haystack" then import ../nixos/haystack.nix { mkHaystackPackage = factory; }
       else import ../nixos/manure.nix { mkManurePackage = factory; })
      stubs
      { smind.services.${name} = {
          enable = true;
          package = if name == "manure" then manureStub else pkgs.hello;
          inherit users;
          database.passwordFile = "/run/secrets/${name}-database";
          database.jdbcUrl = "jdbc:postgresql://127.0.0.1:15434/${name}";
          database.readinessUnit = "database-${name}.service";
          proxy.enable = false;
        } // lib.optionalAttrs (name == "manure") {
          apiOrigin = "https://artifacts.example.test";
          contentMode = "path";
        };
      }
      extra
    ];
  }).config;
  valid = config: lib.all (a: a.assertion) config.assertions;
  setUser = name: change: { smind.services.${name}.users.alice = lib.mkForce (users.alice // change); };
  services = [ "haystack" "manure" ];
  h = system "haystack" { };
  m = system "manure" { };
  hm = extra: (lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      (import ../hm/agentic-services-server.nix { inherit inputs; })
      ./user-services-stub.nix
      ./agentic-services-legacy-config.nix
      extra
    ];
  }).config;
  hmExtra = hm {
    smind.hm.services.agentic = lib.genAttrs services (name: {
      operator.login = "operator-${name}";
      operator.passwordHashFile = "/run/secrets/common-operator-pbkdf2";
      users.alice = users.alice;
      users.password-only = users.password-only;
    });
  };
  legacyHm = hm { };
  user = id: list: lib.findFirst (u: u.id == id) (throw "missing account ${id}") list;
  checks = {
    nixos-positive = lib.all (name: valid (system name { })) services;
    nixos-password-only = lib.all (name: (system name { }).smind.services.${name}.users.password-only.tokens == { }) services;
    nixos-enabled-default = lib.all (name: (system name { }).smind.services.${name}.users.alice.enabled) services;
    nixos-disabled-account = !h.smind.services.haystack.users.retired.enabled && !m.smind.services.manure.users.retired.enabled;
    nixos-unpaired-login = lib.all (name: !valid (system name (setUser name { passwordHashFile = null; }))) services;
    nixos-unpaired-hash = lib.all (name: !valid (system name (setUser name { login = null; }))) services;
    nixos-empty-login = lib.all (name: !valid (system name (setUser name { login = ""; }))) services;
    nixos-exact-unicode-login = lib.all (name: valid (system name (setUser name { login = "  Alice Ω  "; }))) services;
    nixos-case-distinct-logins = lib.all (name: valid (system name (setUser name { login = "PASSWORD-ONLY"; }))) services;
    nixos-duplicate-disabled-login = lib.all (name: !valid (system name {
      smind.services.${name}.users.retired = {
        login = "alice";
        passwordHashFile = "/run/secrets/retired-password";
      };
    })) services;
    nixos-password-credential-collision = lib.all (name: !valid (system name {
      smind.services.${name}.users = {
        "password@only" = { type = "human"; login = "at-sign"; passwordHashFile = "/run/secrets/one"; };
        password_only = { type = "human"; login = "underscore"; passwordHashFile = "/run/secrets/two"; };
      };
    })) services;
    nixos-agent-password = lib.all (name: !valid (system name (setUser name { type = "agent"; }))) services;
    nixos-no-credentials = lib.all (name: !valid (system name (setUser name { tokens = { }; login = null; passwordHashFile = null; }))) services;
    nixos-relative-password = lib.all (name: !valid (system name (setUser name { passwordHashFile = "relative"; }))) services;
    nixos-store-password = lib.all (name: !valid (system name (setUser name { passwordHashFile = "/nix/store/hash"; }))) services;
    nixos-store-root-password = lib.all (name: !valid (system name (setUser name { passwordHashFile = "/nix/store"; }))) services;
    nixos-disabled-service = lib.all (name:
      let c = system name { smind.services.${name}.enable = lib.mkForce false; };
      in c.systemd.services == { } && c.assertions == [ ]) services;
    haystack-password-credential = builtins.elem "haystack-password-alice:/run/secrets/alice-pbkdf2" h.systemd.services.haystack.serviceConfig.LoadCredential;
    haystack-token-preserved = builtins.elem "haystack-hash-alice-configured:/run/secrets/alice-api-sha256" h.systemd.services.haystack.serviceConfig.LoadCredential;
    haystack-migration-credentials = h.systemd.services.haystack-setup.serviceConfig.LoadCredential == h.systemd.services.haystack.serviceConfig.LoadCredential;
    haystack-check-before-migrate = lib.hasInfix "check-config" h.systemd.services.haystack-setup.serviceConfig.ExecStartPre;
    haystack-migration-readiness = h.systemd.services.haystack-setup.requires == [ "database-haystack.service" ];
    manure-password-credential = builtins.elem "manure-password-alice:/run/secrets/alice-pbkdf2" m.systemd.services.manure.serviceConfig.LoadCredential;
    manure-token-preserved = builtins.elem "manure-hash-alice-configured:/run/secrets/alice-api-sha256" m.systemd.services.manure.serviceConfig.LoadCredential;
    manure-migration-credentials = m.systemd.services.manure-migrate.serviceConfig.LoadCredential == m.systemd.services.manure.serviceConfig.LoadCredential;
    manure-check-before-migrate = lib.hasInfix "check-config" m.systemd.services.manure-migrate.serviceConfig.ExecStartPre;
    manure-migration-readiness = m.systemd.services.manure-migrate.requires == [ "database-manure.service" ];
    hm-positive = valid hmExtra;
    hm-extra-users = lib.all (name:
      let values = if name == "haystack" then hmExtra.lib.ponygirls.agenticServices.haystackAuth.value.users else hmExtra.lib.ponygirls.agenticServices.manureConfig.value.users;
      in (user "alice" values).passwordHashFile == "/run/secrets/alice-pbkdf2" && (user "password-only" values).tokens == [ ]) services;
    hm-default-operator = lib.all (name:
      let values = if name == "haystack" then legacyHm.lib.ponygirls.agenticServices.haystackAuth.value.users else legacyHm.lib.ponygirls.agenticServices.manureConfig.value.users;
      in (user "operator" values).login == "operator" && (user "operator" values).passwordHashFile == "/home/alice/.local/state/ivm-services/credentials/${name}-operator.pbkdf2") services;
    hm-explicit-operator = lib.all (name:
      let values = if name == "haystack" then hmExtra.lib.ponygirls.agenticServices.haystackAuth.value.users else hmExtra.lib.ponygirls.agenticServices.manureConfig.value.users;
      in (user "operator" values).login == "operator-${name}" && (user "operator" values).passwordHashFile == "/run/secrets/common-operator-pbkdf2") services;
    hm-password-provisioner-arguments = lib.all (name: lib.hasInfix "--${name}-operator-password-hash-file /run/secrets/common-operator-pbkdf2" hmExtra.systemd.user.services.ivm-services-setup.Service.ExecStart.text) services;
    hm-no-password-argv = !(lib.hasInfix "--password " hmExtra.systemd.user.services.ivm-services-setup.Service.ExecStart.text);
    hm-duplicate-fixed-id = lib.all (name: !valid (hm { smind.hm.services.agentic.${name}.users.operator = users.alice; })) services;
    hm-agent-password = lib.all (name: !valid (hm { smind.hm.services.agentic.${name}.users.alice = users.alice // { type = "agent"; }; })) services;
    hm-unpaired-password = lib.all (name: !valid (hm { smind.hm.services.agentic.${name}.users.alice = users.alice // { login = null; }; })) services;
    hm-duplicate-operator-login = lib.all (name: !valid (hm { smind.hm.services.agentic.${name}.users.alice = users.alice // { enabled = false; login = "operator"; }; })) services;
    hm-immutable-declared-token-binding = lib.all (name:
      let values = if name == "haystack" then hmExtra.lib.ponygirls.agenticServices.haystackAuth.value.users else hmExtra.lib.ponygirls.agenticServices.manureConfig.value.users;
      in (user "alice" values).tokens == [ { id = "configured"; hashFile = "/run/secrets/alice-api-sha256"; } ]) services;
    hm-store-password = lib.all (name: !valid (hm { smind.hm.services.agentic.${name}.operator.passwordHashFile = "/nix/store/hash"; })) services;
    hm-check-before-haystack-migrate = lib.hasInfix "check-config" hmExtra.systemd.user.services.ivm-haystack-migrate.Service.ExecStartPre;
    hm-check-before-manure-migrate = lib.hasInfix "check-config" hmExtra.systemd.user.services.ivm-manure-migrate.Service.ExecStartPre;
  };
  checked = lib.mapAttrsToList (name: value: if value then name else throw "service account contract failed: ${name}") checks;
  haystackConfig = lib.last (lib.splitString " " h.systemd.services.haystack.serviceConfig.ExecStart);
in
assert builtins.deepSeq checked true;
pkgs.runCommandLocal "service-accounts-declarations" {
  nativeBuildInputs = [ pkgs.python3 ];
  inherit haystackConfig;
  manureLauncher = m.systemd.services.manure.serviceConfig.ExecStart;
  receipt = builtins.toJSON { checks = checked; cases = builtins.length checked + 1; failures = 0; errors = 0; skips = 0; };
} ''
  mkdir -p "$out" "$TMPDIR/credentials" "$TMPDIR/runtime"
  export CREDENTIALS_DIRECTORY="$TMPDIR/credentials" RUNTIME_DIRECTORY="$TMPDIR/runtime" CAPTURE_CONFIG="$TMPDIR/captured.json"
  python3 - "$haystackConfig" <<'PY'
  import json, os, pathlib
  config = json.loads(pathlib.Path(__import__('sys').argv[1]).read_text())
  users = {u['id']: u for u in config['auth']['users']}
  assert users['alice']['enabled'] is True
  assert users['retired']['enabled'] is False
  assert users['alice']['login'] == 'alice'
  assert users['alice']['passwordHashFile'] == '$CREDENTIALS_DIRECTORY/haystack-password-alice'
  assert users['alice']['tokens'] == [{'id': 'configured', 'hashFile': '$CREDENTIALS_DIRECTORY/haystack-hash-alice-configured'}]
  assert users['password-only']['tokens'] == []
  assert 'passwordHashFile' not in users['agent'] and 'login' not in users['agent']
  directory = pathlib.Path(os.environ['CREDENTIALS_DIRECTORY'])
  for name in ('manure-hash-alice-configured', 'manure-hash-retired-retained', 'manure-hash-agent-default'):
      (directory / name).write_text('0' * 64 + '\n')
  for name in ('manure-password-alice', 'manure-password-password-only'):
      os.mkfifo(directory / name)
  PY
  "$manureLauncher"
  python3 - <<'PY'
  import json, os, pathlib
  config = json.loads(pathlib.Path(os.environ['CAPTURE_CONFIG']).read_text())
  users = {u['id']: u for u in config['users']}
  assert users['alice']['enabled'] is True and users['retired']['enabled'] is False
  assert users['alice']['login'] == 'alice'
  assert users['alice']['passwordHashFile'] == os.environ['CREDENTIALS_DIRECTORY'] + '/manure-password-alice'
  assert users['alice']['tokens'] == [{'id': 'configured', 'hashFile': os.environ['CREDENTIALS_DIRECTORY'] + '/manure-hash-alice-configured'}]
  assert users['password-only']['tokens'] == []
  assert 'passwordHashFile' not in users['agent'] and 'login' not in users['agent']
  assert all('passwordCredential' not in u for u in users.values())
  PY
  printf '%s\n' "$receipt" > "$out/receipt.json"
''
