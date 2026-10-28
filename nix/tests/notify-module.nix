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
          home.preferXdgDirectories = lib.mkOption {
            type = lib.types.bool;
            default = false;
          };
          xdg.configHome = lib.mkOption {
            type = lib.types.str;
            default = "/home/test/.config";
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
  e2eeRecovery = evaluate {
    notify.transport = "e2ee";
    notify.passwordFile = "/run/agenix/matrix-notify-password";
    notify.recoveryKeyFile = "/run/agenix/matrix-notify-recovery-key";
  };
  plaintextSecrets = evaluate {
    notify.passwordFile = "/run/agenix/matrix-notify-password";
    notify.recoveryKeyFile = "/run/agenix/matrix-notify-recovery-key";
  };
  testPython = pkgs.python3.withPackages (ps: [ ps.matrix-nio ps.vodozemac ps.pycryptodome ps.cachetools ps.atomicwrites ps.peewee ]);
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
assert enabled.programs.codex.settings.hooks.state."/home/test/.codex/config.toml:user_prompt_submit:0:0".trusted_hash or null != null;
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
assert builtins.elem "/run/agenix/matrix-notify-password" e2eeRecovery.smind.hm.dev.llm.yolo.extraReadOnlyPaths;
assert builtins.elem "/run/agenix/matrix-notify-recovery-key" e2eeRecovery.smind.hm.dev.llm.yolo.extraReadOnlyPaths;
assert !(builtins.elem "/run/agenix/matrix-notify-password" e2ee.smind.hm.dev.llm.yolo.extraReadOnlyPaths);
assert !(builtins.elem "/run/agenix/matrix-notify-recovery-key" e2ee.smind.hm.dev.llm.yolo.extraReadOnlyPaths);
assert !(builtins.elem "/run/agenix/matrix-notify-password" plaintextSecrets.smind.hm.dev.llm.yolo.extraReadOnlyPaths);
assert !(builtins.elem "/run/agenix/matrix-notify-recovery-key" plaintextSecrets.smind.hm.dev.llm.yolo.extraReadOnlyPaths);
pkgs.runCommandLocal "notify-module-test" {
  nativeBuildInputs = [ testPython pkgs.nodejs pkgs.bash ];
  NOTIFY_PI_EXTENSION = builtins.head enabled.programs.pi.settings.extensions;
  NOTIFY_TEST_PACKAGES = lib.concatMapStringsSep " " (name: "${enabled.programs.${name}.package}/bin/${if name == "claude-code" then "claude" else name}") [ "claude-code" "codex" "pi" ];
  NOTIFY_CODEX_HOOKS = builtins.toJSON enabled.programs.codex.settings.hooks.UserPromptSubmit;
  NOTIFY_CODEX_TRUST = builtins.toJSON enabled.programs.codex.settings.hooks.state;
} ''
  export PYTHONDONTWRITEBYTECODE=1
  export XDG_CACHE_HOME=$TMPDIR/cache
  python3 -c "import Crypto, vodozemac, nio"
  python3 -m unittest discover -s ${../pkg/agent-notify} -p '*_test.py'
  node --test ${../pkg/agent-notify/pi.test.mjs}
  for command in $NOTIFY_TEST_PACKAGES; do
    "$command"
  done
  python3 - <<'PYEOF'
import hashlib, json, os
# Codex hook trust, as implemented by codex-rs 0.164.0 (verified against a
# live `codex` trust approval): trusted_hash is sha256 over the canonical
# JSON of {event_name, hooks:[{type,command,timeout,async}]} with sorted
# keys and compact separators, None fields omitted, timeout defaulting to
# 600 and the matcher dropped for user_prompt_submit. The state key is
# <user config.toml path>:<event label>:<group>:<handler>.
trust = json.loads(os.environ["NOTIFY_CODEX_TRUST"])
hooks = json.loads(os.environ["NOTIFY_CODEX_HOOKS"])
assert list(trust) != []
for gi, group in enumerate(hooks):
    for hi, handler in enumerate(group["hooks"]):
        key = f"/home/test/.codex/config.toml:user_prompt_submit:{gi}:{hi}"
        assert key in trust, f"missing trust entry for {key}"
        identity = {
            "event_name": "user_prompt_submit",
            "hooks": [{
                "type": handler["type"],
                "command": handler["command"],
                "timeout": handler.get("timeout") or 600,
                "async": handler.get("async") or False,
            }],
        }
        if handler.get("statusMessage") is not None:
            identity["hooks"][0]["statusMessage"] = handler["statusMessage"]
        expected = "sha256:" + hashlib.sha256(
            json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        assert trust[key]["trusted_hash"] == expected, f"trust hash mismatch for {key}"
# Pinned approval vector from a live codex 0.164.0 `/hooks` trust of the
# matrix-notify command: guards the algorithm itself against drift.
probe = {"event_name": "user_prompt_submit", "hooks": [{"async": False, "command": "/nix/store/khczv8yc2l1lxk0l6r8glkfj2q1sj2af-agent-notify-matrix/bin/agent-notify-matrix codex --start", "timeout": 600, "type": "command"}]}
assert "sha256:" + hashlib.sha256(json.dumps(probe, sort_keys=True, separators=(",", ":")).encode()).hexdigest() == "sha256:348cda23bb1cbc17c8dc43108048fdbe8cb060c9dce69e4367d3b5aed9183d26"
print("codex hook trust verified")
PYEOF
  touch $out
''
