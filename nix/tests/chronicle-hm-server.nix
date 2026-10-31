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
      database = { passwordFile = "/fixture/database-password"; port = 25433; restartTriggers = [ "/fixture/db-revision" ]; };
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
    postgres = services.custom-archive-postgres.Service.ExecStart;
    database = services.custom-archive-database.Service.ExecStart;
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
assert services.custom-archive.Unit.Requires == [ "custom-archive-database.service" "embedding.service" ];
assert services.custom-archive.Unit.PartOf == [ "custom-archive-postgres.service" ];
assert services.custom-archive-postgres.Service.KillSignal == "SIGINT";
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
  bash postgres > postgres.log 2>&1 &
  postgres_pid=$!
  trap 'kill -INT "$postgres_pid" 2>/dev/null || true; wait "$postgres_pid" || true' EXIT
  bash database
  socket="$TMPDIR/fixture/chronicle/postgres-socket"
  test "$(psql -X -h "$socket" -p 25433 -d chronicle -tAc "SELECT extname FROM pg_extension WHERE extname = 'vector'")" = vector
  psql -X -h "$socket" -p 25433 -d chronicle -v ON_ERROR_STOP=1 -c 'CREATE TABLE retained (value int); INSERT INTO retained VALUES (42);'
  bash database
  test "$(psql -X -h "$socket" -p 25433 -d chronicle -tAc 'SELECT value FROM retained')" = 42
  bash backup
  dump=$(find "$TMPDIR/fixture/chronicle/backups" -name '*.dump')
  pg_restore --list "$dump" > dump-list
  grep -q retained dump-list
  kill -INT "$postgres_pid"
  wait "$postgres_pid"
  trap - EXIT
  bash postgres > restart.log 2>&1 &
  postgres_pid=$!
  trap 'kill -INT "$postgres_pid" 2>/dev/null || true; wait "$postgres_pid" || true' EXIT
  bash database
  test "$(psql -X -h "$socket" -p 25433 -d chronicle -tAc 'SELECT value FROM retained')" = 42
  kill -INT "$postgres_pid"
  wait "$postgres_pid"
  trap - EXIT
  echo 'PASS: inertness, runtime credential paths, restart graph, setup, PostgreSQL/pgvector, persistence and backup'
  touch "$out"
''
