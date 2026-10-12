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
          smind.hm.dev.llm.yolo.extraReadWritePaths = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [ ];
          };
          home.homeDirectory = lib.mkOption {
            type = lib.types.str;
            default = "/home/test";
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
  e2ee = evaluate { notify.transport = "e2ee"; };
  bodyOnPlaintext = evaluate { notify.includeMessageBody = true; };
  bodyOnE2EE = evaluate { notify.transport = "e2ee"; notify.includeMessageBody = true; };
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
assert lib.all (name: enabled.programs.${name}.package.name == harness.name) [ "claude-code" "codex" "pi" ];
assert lib.all (name: disabled.programs.${name}.package.name == harness.name) [ "claude-code" "codex" "pi" ];
assert builtins.elem "/home/test/.local/share/agent-notify-matrix" e2ee.smind.hm.dev.llm.yolo.extraReadWritePaths;
assert builtins.elem existingPath e2ee.smind.hm.dev.llm.yolo.extraReadOnlyPaths;
assert !(lib.all (assertion: assertion.assertion) bodyOnPlaintext.assertions);
assert lib.all (assertion: assertion.assertion) bodyOnE2EE.assertions;
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
