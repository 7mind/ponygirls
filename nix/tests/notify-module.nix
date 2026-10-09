{ lib, pkgs }:
let
  tokenFile = "/run/agenix/matrix-notify";
  existingPath = "/srv/models";
  client = pkgs.writeShellScript "notify-test-client" "exit 0";
  harness = pkgs.runCommandLocal "notify-test-harness" { version = "1.0.0"; } ''
    mkdir -p $out/bin
    for name in claude codex pi; do
      ln -s ${client} $out/bin/$name
    done
  '';
  settings = {
    enable = true;
    yolo.extraReadOnlyPaths = [ existingPath ];
    notify = {
      enable = true;
      homeserver = "https://matrix.example.org";
      roomId = "!notifications:matrix.example.org";
      inherit tokenFile;
    };
  };
  evaluate = overrides: (lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      ../hm/notify.nix
      ({ lib, ... }: {
        options = {
          smind.hm.dev.llm.enable = lib.mkEnableOption "coding-agent environment";
          smind.hm.dev.llm.yolo.extraReadOnlyPaths = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [ ];
          };
          assertions = lib.mkOption {
            type = lib.types.listOf lib.types.attrs;
            default = [ ];
          };
          home.packages = lib.mkOption {
            type = lib.types.listOf lib.types.package;
            default = [ ];
          };
          programs = lib.genAttrs [ "claude-code" "codex" "pi" ] (_: {
            package = lib.mkOption {
              type = lib.types.nullOr lib.types.package;
              default = harness;
            };
            settings = lib.mkOption {
              type = (pkgs.formats.json { }).type;
              default = { };
            };
          });
        };
      })
      { smind.hm.dev.llm = lib.recursiveUpdate settings overrides; }
    ];
  }).config;
  enabled = evaluate { };
  disabled = evaluate { notify.enable = false; };
  noToken = evaluate { notify.tokenFile = null; };
  noHarness = evaluate { enable = false; };
  durationOnly = evaluate { notify.onlyWhenUnfocused = false; };
in
assert lib.all (assertion: assertion.assertion) enabled.assertions;
assert builtins.elem tokenFile enabled.smind.hm.dev.llm.yolo.extraReadOnlyPaths;
assert builtins.elem existingPath enabled.smind.hm.dev.llm.yolo.extraReadOnlyPaths;
assert disabled.smind.hm.dev.llm.yolo.extraReadOnlyPaths == [ existingPath ];
assert noToken.smind.hm.dev.llm.yolo.extraReadOnlyPaths == [ existingPath ];
assert !(lib.all (assertion: assertion.assertion) noToken.assertions);
assert noHarness.smind.hm.dev.llm.yolo.extraReadOnlyPaths == [ existingPath ];
assert enabled.programs.codex.settings.hooks.UserPromptSubmit != [ ];
assert enabled.programs.claude-code.settings.hooks.UserPromptSubmit != [ ];
assert enabled.programs.claude-code.settings.hooks.Notification == [ {
  matcher = "permission_prompt";
  hooks = [ {
    type = "command";
    command = "${builtins.head enabled.home.packages}/bin/agent-notify-matrix claude --attention";
  } ];
} ];
assert lib.all (name: enabled.programs.${name}.package.name != harness.name) [ "claude-code" "codex" "pi" ];
assert lib.all (name: enabled.programs.${name}.package.version == harness.version) [ "claude-code" "codex" "pi" ];
assert lib.all (name: disabled.programs.${name}.package.name == harness.name) [ "claude-code" "codex" "pi" ];
assert lib.all (name: durationOnly.programs.${name}.package.name == harness.name) [ "claude-code" "codex" "pi" ];
pkgs.runCommandLocal "notify-module-test" {
  nativeBuildInputs = [ pkgs.python3 pkgs.nodejs pkgs.bash ];
  NOTIFY_PI_EXTENSION = builtins.head enabled.programs.pi.settings.extensions;
  NOTIFY_TEST_PACKAGES = lib.concatMapStringsSep " " (name: "${enabled.programs.${name}.package}/bin/${if name == "claude-code" then "claude" else name}") [ "claude-code" "codex" "pi" ];
} ''
  export PYTHONDONTWRITEBYTECODE=1
  export XDG_CACHE_HOME=$TMPDIR/cache
  python3 -m unittest discover -s ${../pkg/agent-notify} -p '*_test.py'
  node --test ${../pkg/agent-notify/pi.test.mjs}
  for command in $NOTIFY_TEST_PACKAGES; do
    "$command"
  done
  touch $out
''
