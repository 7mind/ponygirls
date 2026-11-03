{ pkgs, chronicleModule }:
let
  inherit (pkgs) lib;
  server = pkgs.writeShellScriptBin "chronicle-server" ''
    set -euo pipefail
    test "$1" = password-hash
    printf 'fixture-hash:'
    ${pkgs.coreutils}/bin/sha256sum
  '';
  evaluate = extra: (lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [ ./user-services-stub.nix chronicleModule extra ];
  }).config;
  disabled = evaluate { };
  fixture = {
    smind.hm.services.chronicle = {
      enable = true;
      package = server;
      stateDirectory = "/fixture/chronicle";
      unitPrefix = "custom-archive";
      setupDependencies = [ "external-secrets.service" ];
      serverDependencies = [ "embedding.service" ];
      restartTriggers = [ "/fixture/revision" ];
      passwords.alice = { passwordFile = "/fixture/password"; revisionFile = "/fixture/revision"; };
      database = { passwordFile = "/fixture/database-password"; port = 25433; readinessUnit = "ponygirls-database-chronicle.service"; restartTriggers = [ "/fixture/db-revision" ]; };
      settings = {
        listenHost = "127.0.0.1";
        listenPort = 47330;
        maxBodyBytes = 8388608;
        allowedOrigin = "https://archive.example.net";
        users = [{ id = "alice"; login = "alice"; enabled = true; passwordHashFile = "/fixture/chronicle/credentials/alice.pbkdf2"; }];
      };
    };
    systemd.user.services.embedding.Service.ExecStart = "${pkgs.coreutils}/bin/true";
  };
  cfg = evaluate fixture;
  services = cfg.systemd.user.services;
  rendered = cfg.lib.ponygirls.chronicleServer.serverConfig;
  invalid = evaluate (lib.recursiveUpdate fixture { smind.hm.services.chronicle.database.passwordFile = "/nix/store/secret"; });
  storeRoot = evaluate (lib.recursiveUpdate fixture { smind.hm.services.chronicle.stateDirectory = "/nix/store"; });
  invalidSettings = evaluate (lib.recursiveUpdate fixture { smind.hm.services.chronicle.settings.jdbcUrl = "ignored"; });
  badListener = evaluate (lib.recursiveUpdate fixture { smind.hm.services.chronicle.settings.listenHost = "0.0.0.0"; });
  badName = evaluate (lib.recursiveUpdate fixture { smind.hm.services.chronicle.passwords."../escape" = { passwordFile = "/fixture/password"; revisionFile = "/fixture/revision"; }; });
  scripts = {
    setup = services.custom-archive-setup.Service.ExecStart;
    backup = services.custom-archive-backup.Service.ExecStart;
  };
in
assert disabled.systemd.user.services == { } && disabled.systemd.user.timers == { };
assert lib.all (a: a.assertion) cfg.assertions;
assert lib.any (a: !a.assertion) invalid.assertions;
assert lib.any (a: !a.assertion) storeRoot.assertions;
assert lib.any (a: !a.assertion) invalidSettings.assertions;
assert lib.any (a: !a.assertion) badName.assertions;
assert lib.any (a: !a.assertion) badListener.assertions;
assert lib.hasInfix "client_max_body_size 8388608;" cfg.lib.ponygirls.chronicleServer.proxyLocations;
assert lib.hasInfix "proxy_pass http://127.0.0.1:47330;" cfg.lib.ponygirls.chronicleServer.proxyLocations;
assert lib.hasInfix "limit_req_zone" cfg.lib.ponygirls.chronicleServer.proxyHttpConfig;
assert rendered.value.jdbcUrl == "jdbc:postgresql://127.0.0.1:25433/chronicle";
assert rendered.value.databaseUser == "chronicle";
assert rendered.value.databasePasswordFile == "/fixture/database-password";
assert rendered.value.users == fixture.smind.hm.services.chronicle.settings.users;
assert services.custom-archive-setup.Unit.Wants == [ "external-secrets.service" ];
assert !(services.custom-archive-setup.Unit ? Requires);
assert services.custom-archive.Unit.Requires == [ "custom-archive-migrate.service" "embedding.service" ];
assert services.custom-archive-migrate.Unit.Requires == [ "ponygirls-database-chronicle.service" ];
assert rendered.value.databaseLimits == { maxConnections = 8; maxQueued = 32; queueTimeoutMs = 5000; connectTimeoutMs = 5000; statementTimeoutMs = 30000; lockTimeoutMs = 5000; idleTransactionTimeoutMs = 30000; socketTimeoutMs = 40000; };
assert !(services.custom-archive.Unit ? PartOf);
assert !(services ? custom-archive-postgres);
assert !(services ? custom-archive-database);
assert !cfg.ponygirls.servicePostgres.enable;
assert services.custom-archive-backup.Unit.Requires == [ "ponygirls-database-chronicle.service" ];
assert cfg.systemd.user.timers.custom-archive-backup.Timer.Persistent;
assert builtins.elem "/fixture/revision" services.custom-archive.Unit.X-Restart-Triggers;
assert builtins.elem cfg.xdg.configFile."systemd/user/embedding.service".source services.custom-archive.Unit.X-Restart-Triggers;
pkgs.runCommand "chronicle-hm-server" {
  nativeBuildInputs = [ cfg.smind.hm.services.chronicle.database.package pkgs.bash pkgs.coreutils pkgs.gnused ];
} ''
  set -euo pipefail
  mkdir -p "$TMPDIR/fixture"
  printf 'fixture-password\n' > "$TMPDIR/fixture/password"
  printf 'revision-1\n' > "$TMPDIR/fixture/revision"
  printf 'database-password\n' > "$TMPDIR/fixture/database-password"
  ${lib.concatStrings (lib.mapAttrsToList (name: script: ''
    substitute ${script} ${name} --replace-fail /fixture "$TMPDIR/fixture"
  '') scripts)}
  bash setup
  test "$(stat -c %a "$TMPDIR/fixture/chronicle/credentials")" = 700
  first=$(cat "$TMPDIR/fixture/chronicle/credentials/alice.pbkdf2")
  bash setup
  test "$(cat "$TMPDIR/fixture/chronicle/credentials/alice.pbkdf2")" = "$first"
  printf 'next-password\n' > "$TMPDIR/fixture/password"
  printf 'revision-2\n' > "$TMPDIR/fixture/revision"
  bash setup
  test "$(cat "$TMPDIR/fixture/chronicle/credentials/alice.pbkdf2")" != "$first"
  # Cluster runtime/dumps/restores are exercised by shared-postgres. Here
  # verify the actual consumer emits only explicit TCP/credential backup wiring.
  grep -q -- '-h 127.0.0.1' backup
  grep -q -- '--no-password' backup
  grep -q 'PGPASSWORD' backup
  ! grep -q 'initdb' backup
  echo 'PASS: consumer inertness, explicit database readiness graph, no hidden cluster, runtime credential preservation, TCP backup wiring'
  touch "$out"
''
