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
      hardware = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
      virtualisation = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
    };
  };
  chronicleSystem = extra: (lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      (import ../nixos/chronicle.nix { mkChroniclePackage = factory; })
      stubs
      { smind.services.chronicle = {
          enable = true;
          package = pkgs.hello;
          publicUrl = "https://chronicle.example.test";
          users.alice = { login = "alice"; passwordHashFile = "/run/secrets/alice-pbkdf2"; };
          database = { passwordFile = "/run/secrets/chronicle-database"; jdbcUrl = "jdbc:postgresql://127.0.0.1:15434/chronicle"; };
          annotation = { requestPolicy = "strict-json-schema"; endpoint = "http://127.0.0.1:8000/v1/chat/completions"; model = "annotation"; revision = "v1"; credentialFile = "/run/secrets/annotation-key"; };
          embedding = { endpoint = "http://127.0.0.1:8001/v1/embeddings"; model = "embedding"; revision = "v1"; credentialFile = "/run/secrets/embedding-key"; dimensions = 768; queryPrefix = ""; documentPrefix = ""; };
        };
      }
      extra
    ];
  }).config;
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
  hmIndexingAdmin = hm {
    smind.hm.services.agentic = lib.genAttrs services (_: {
      operator.admin = false;
      users.alice = users.alice // { admin = true; };
    });
  };
  user = id: list: lib.findFirst (u: u.id == id) (throw "missing account ${id}") list;
  # Imperative accounts (docs/drafts/20261117-2040-self-signup-admin-enrollment-design.md §6, AM1).
  accountServices = services ++ [ "chronicle" ];
  serviceSystem = name: if name == "chronicle" then chronicleSystem else system name;
  migrationUnit = { haystack = "haystack-setup"; manure = "manure-migrate"; chronicle = "chronicle-migrate"; };
  keyFile = "/run/secrets/accounts-key";
  rejects = needle: config: lib.any (a: !a.assertion && lib.hasInfix needle a.message) config.assertions;
  accountsWith = name: settings: { smind.services.${name} = { accounts = settings; users.alice.admin = true; }; };
  # With the master off, the imperative accounts block stays out of JSON,
  # but the declarative admin flag is still rendered.
  accountsOff = name: accountsWith name {
    inherit keyFile;
    signup = { requireApproval = false; maxUsers = 7; };
    enrollment.ttlSeconds = 600;
    issuer = "Inert";
    reservedUsernames = [ "root" ];
  };
  accountsOn = name: lib.recursiveUpdate (accountsWith name { enable = true; inherit keyFile; signup.enable = true; enrollment.enable = true; })
    (lib.optionalAttrs (name == "haystack") { smind.services.haystack.publicUrl = "https://memory.example.test"; });
  onWith = name: change: serviceSystem name (lib.recursiveUpdate (accountsOn name) change);
  hmAccounts = extra: hm (lib.recursiveUpdate { smind.hm.services.agentic = lib.genAttrs services (_: { accounts = { enable = true; signup.enable = true; }; }); } extra);
  hmOn = hmAccounts { };
  hmRendered = config: name: if name == "haystack" then config.lib.ponygirls.agenticServices.haystackAuth.value else config.lib.ponygirls.agenticServices.manureConfig.value;
  hmSetup = config: config.systemd.user.services.ivm-services-setup.Service.ExecStart.text;
  chronicleHm = settings: (lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      (import ../hm/chronicle-server.nix { mkChroniclePackage = factory; })
      ./user-services-stub.nix
      { smind.hm.services.chronicle = {
          enable = true;
          package = pkgs.hello;
          stateDirectory = "/fixture/chronicle";
          database.passwordFile = "/run/secrets/chronicle-database";
          settings = {
            listenHost = "127.0.0.1";
            listenPort = 47330;
            maxBodyBytes = 8388608;
            allowedOrigin = "https://chronicle.example.test";
            users = [ chronicleAlice ];
          } // settings;
        };
      }
    ];
  }).config;
  chronicleAlice = { id = "alice"; login = "alice"; enabled = true; passwordHashFile = "/fixture/chronicle/credentials/alice.pbkdf2"; };
  chronicleHmAccounts = settings: chronicleHm ({ accounts.enabled = true; users = [ (chronicleAlice // { admin = true; }) ]; } // settings);
  chronicleHmOn = chronicleHmAccounts { };
  chronicleHmSetup = config: config.systemd.user.services.chronicle-setup.Service.ExecStart;
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
    accounts-off-valid = lib.all (name: valid (serviceSystem name (accountsOff name))) accountServices;
    # Manure runs in path content mode here: signup is permitted there (owner decision Q84).
    accounts-on-valid = lib.all (name: valid (serviceSystem name (accountsOn name))) accountServices;
    accounts-key-credential = lib.all (name:
      let units = (serviceSystem name (accountsOn name)).systemd.services;
      in builtins.elem "accounts-key:${keyFile}" units.${name}.serviceConfig.LoadCredential
        && units.${migrationUnit.${name}}.serviceConfig.LoadCredential == units.${name}.serviceConfig.LoadCredential) accountServices;
    accounts-creation-requires-master = lib.all (name: lib.all (flag:
      rejects "never derived" (serviceSystem name (accountsWith name { inherit keyFile; ${flag}.enable = true; }))) [ "signup" "enrollment" ]) accountServices;
    accounts-key-file-required = lib.all (name: lib.all (path:
      rejects "accounts.keyFile" (onWith name { smind.services.${name}.accounts.keyFile = path; })) [ null "relative" "/nix/store/key" ]) accountServices;
    accounts-declarative-admin-required = lib.all (name:
      rejects "enabled declarative admin" (onWith name { smind.services.${name}.users.alice.admin = false; })
      && rejects "enabled declarative admin" (onWith name { smind.services.${name}.users.alice.enabled = false; })) accountServices;
    accounts-admin-human-browser = lib.all (name: lib.all (id:
      rejects "admin = true" (system name { smind.services.${name}.users.${id}.admin = true; })) [ "agent" "retired" ]) services;
    accounts-public-origin-required = rejects "public origin" (onWith "haystack" { smind.services.haystack.publicUrl = null; });
    hm-accounts-off = lib.all (name:
      let rendered = hmRendered legacyHm name;
      in !(rendered ? accounts) && (user "operator" rendered.users).admin && !((user "agent" rendered.users) ? admin)
        && !(lib.hasInfix "accounts-key" (hmSetup legacyHm))) services;
    hm-declared-admin-with-accounts-off = valid hmIndexingAdmin && lib.all (name:
      let rendered = hmRendered hmIndexingAdmin name;
      in !(rendered ? accounts) && (user "alice" rendered.users).admin && !((user "operator" rendered.users) ? admin)) services;
    hm-accounts-provisioned-key = valid hmOn && lib.all (name:
      (hmRendered hmOn name).accounts.${if name == "haystack" then "keyFile" else "key_file"} == "/home/alice/.local/state/ivm-services/credentials/${name}-accounts.key"
      && lib.hasInfix "--${name}-accounts-key" (hmSetup hmOn)
      && (user "operator" (hmRendered hmOn name).users).admin && !(user "agent" (hmRendered hmOn name).users).admin) services;
    hm-accounts-explicit-key = let c = hmAccounts { smind.hm.services.agentic.haystack.accounts.keyFile = keyFile; };
      in valid c && c.lib.ponygirls.agenticServices.haystackAuth.value.accounts.keyFile == keyFile && !(lib.hasInfix "--haystack-accounts-key" (hmSetup c))
        && rejects "accounts.keyFile" (hmAccounts { smind.hm.services.agentic.haystack.accounts.keyFile = "/nix/store/key"; });
    hm-accounts-rules = rejects "enabled declarative admin" (hmAccounts { smind.hm.services.agentic.manure.operator.admin = false; })
      && rejects "never derived" (hm { smind.hm.services.agentic.haystack.accounts.enrollment.enable = true; })
      && rejects "admin = true" (hm { smind.hm.services.agentic.haystack.users.bot = { type = "agent"; admin = true; tokens.default.tokenHashFile = "/run/secrets/bot-sha256"; }; });
    hm-chronicle-accounts-rules = valid chronicleHmOn
      && rejects "accounts.keyFile" (chronicleHmAccounts { accounts = { enabled = true; keyFile = "/nix/store/key"; }; })
      && rejects "never derived" (chronicleHm { accounts = { enabled = false; signup.enabled = true; }; })
      && rejects "enabled declarative admin" (chronicleHmAccounts { users = [ chronicleAlice ]; })
      && rejects "admin = true" (chronicleHmAccounts { users = [ (builtins.removeAttrs chronicleAlice [ "passwordHashFile" ] // { admin = true; }) ]; })
      && rejects "public origin" (chronicleHmAccounts { allowedOrigin = null; });
    hm-chronicle-accounts-key = chronicleHmOn.lib.ponygirls.chronicleServer.serverConfig.value.accounts == { enabled = true; keyFile = "/fixture/chronicle/credentials/accounts.key"; }
      && lib.hasInfix "accounts.key" (chronicleHmSetup chronicleHmOn).text
      && !((chronicleHm { }).lib.ponygirls.chronicleServer.serverConfig.value ? accounts)
      && !(lib.hasInfix "accounts.key" (chronicleHmSetup (chronicleHm { })).text)
      && (chronicleHm { accounts = { enabled = true; inherit keyFile; }; }).lib.ponygirls.chronicleServer.serverConfig.value.accounts.keyFile == keyFile
      && !(lib.hasInfix "accounts.key" (chronicleHmSetup (chronicleHm { accounts = { enabled = true; inherit keyFile; }; })).text);
  };
  checked = lib.mapAttrsToList (name: value: if value then name else throw "service account contract failed: ${name}") checks;
  lastWord = command: lib.last (lib.splitString " " command);
  haystackConfig = lastWord h.systemd.services.haystack.serviceConfig.ExecStart;
  generatedConfig = name: config: if name == "manure" then config.systemd.services.manure.serviceConfig.ExecStart
    else lastWord config.systemd.services.${name}.serviceConfig.ExecStart;
in
assert builtins.deepSeq checked true;
pkgs.runCommandLocal "service-accounts-declarations" {
  nativeBuildInputs = [ pkgs.python3 ];
  inherit haystackConfig;
  configsOff = builtins.toJSON (lib.genAttrs accountServices (name: generatedConfig name (serviceSystem name (accountsOff name))));
  configsOn = builtins.toJSON (lib.genAttrs accountServices (name: generatedConfig name (serviceSystem name (accountsOn name))));
  masterOff = ./fixtures/service-accounts-master-off.json;
  chronicleSetup = chronicleHmSetup chronicleHmOn;
  linkCommand = "${pkgs.coreutils}/bin/ln -T";
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
  python3 - <<'PY'
  import json, os, pathlib, re, subprocess
  # Generated configuration: Haystack/Chronicle JSON files; Manure's template behind its launcher.
  def generated(service, path):
      if service == 'manure':
          path = re.search(r"TEMPLATE=(\S+)", pathlib.Path(path).read_text()).group(1)
      return json.loads(re.sub(r"/nix/store/[a-z0-9]{32}-[^/\"]*", "@STORE@", pathlib.Path(path).read_text()))
  # With the master off the sole addition to the legacy JSON is Alice's
  # declared admin flag, including when other imperative settings are present.
  golden = json.loads(pathlib.Path(os.environ['masterOff']).read_text())
  for service, path in json.loads(os.environ['configsOff']).items():
      actual = generated(service, path)
      expected = golden[service]
      directory = expected['auth'] if service == 'haystack' else expected
      next(u for u in directory['users'] if u['id'] == 'alice')['admin'] = True
      assert actual == expected, f"{service}: accounts master off differs from the golden plus declared admin:\n{json.dumps(actual, sort_keys=True)}"
  on = {service: generated(service, path) for service, path in json.loads(os.environ['configsOn']).items()}
  def camel(key_file, issuer):
      return {'enabled': True, 'keyFile': key_file, 'signup': {'enabled': True, 'requireApproval': True, 'maxUsers': 100},
              'enrollment': {'enabled': True, 'ttlSeconds': 86400}, 'issuer': issuer, 'reservedUsernames': []}
  assert on['haystack']['auth']['accounts'] == camel('$CREDENTIALS_DIRECTORY/accounts-key', 'Haystack (memory.example.test)')
  assert on['chronicle']['accounts'] == camel('/run/credentials/chronicle.service/accounts-key', 'Chronicle (chronicle.example.test)')
  assert on['manure']['accounts'] == {'enabled': True, 'key_file': '/run/credentials/manure.service/accounts-key',
                                      'signup': {'enabled': True, 'require_approval': True, 'max_users': 100},
                                      'enrollment': {'enabled': True, 'ttl_s': 86400},
                                      'issuer': 'Manure (artifacts.example.test)', 'reserved_usernames': []}
  for users in (on['haystack']['auth']['users'], on['manure']['users'], on['chronicle']['users']):
      assert {u['id']: u['admin'] for u in users if u['id'] != 'alice'} == {u['id']: False for u in users if u['id'] != 'alice'}
      assert [u['admin'] for u in users if u['id'] == 'alice'] == [True]
  launcher = json.loads(os.environ['configsOn'])['manure']
  subprocess.run([launcher], check=True, env={**os.environ, 'CAPTURE_CONFIG': os.environ['TMPDIR'] + '/captured-on.json'})
  resolved = json.loads(pathlib.Path(os.environ['TMPDIR'], 'captured-on.json').read_text())
  assert resolved['accounts']['key_file'] == os.environ['CREDENTIALS_DIRECTORY'] + '/accounts-key'
  PY
  # Chronicle (Home Manager) provisions its accounts key once, privately, and retains it.
  substitute "$chronicleSetup" chronicle-setup --replace-fail /fixture "$TMPDIR/fixture"
  bash chronicle-setup
  key="$TMPDIR/fixture/chronicle/credentials/accounts.key"
  test "$(stat -c %a "$key")" = 600
  grep -Eqx '[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]' "$key"
  first="$(stat -c %i "$key"):$(cat "$key")"
  bash chronicle-setup
  test "$(stat -c %i "$key"):$(cat "$key")" = "$first"
  # Another setup publishes its key between this one's absence check and its link.
  substitute "$chronicleSetup" racing-setup --replace-fail /fixture "$TMPDIR/race" --replace-fail "$linkCommand" "bash $TMPDIR/concurrent-winner"
  printf '%s\n' 'printf "%s\n" "$WINNER" > "$2"' "exec $linkCommand \"\$1\" \"\$2\"" > "$TMPDIR/concurrent-winner"
  WINNER="$(printf 'w%.0s' {1..42})A" bash racing-setup
  test "$(cat "$TMPDIR/race/chronicle/credentials/accounts.key")" = "$(printf 'w%.0s' {1..42})A"
  test "$(ls -A "$TMPDIR/race/chronicle/credentials")" = accounts.key
  printf '%s\n' "$receipt" > "$out/receipt.json"
''
