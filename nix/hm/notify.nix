{ config, lib, pkgs, ... }:
let
  cfg = config.smind.hm.dev.llm;
  notifyCfg = cfg.notify;
  active =
    notifyCfg.enable
    && notifyCfg.homeserver != null
    && notifyCfg.roomId != null
    && notifyCfg.tokenFile != null;
  runtime = ../pkg/agent-notify;
  settings = pkgs.writeText "agent-notify-matrix.json" (builtins.toJSON {
    inherit (notifyCfg) homeserver roomId tokenFile minTurnSeconds onlyWhenUnfocused;
  });
  notifyScript = pkgs.writeShellScriptBin "agent-notify-matrix" ''
    exec ${pkgs.python3}/bin/python3 ${runtime}/notify.py ${settings} "$@"
  '';
  notifyCommand = "${notifyScript}/bin/agent-notify-matrix";
  notifyExtension = pkgs.writeText "ponygirls-agent-notify-matrix.ts" (
    lib.replaceStrings [ "@notifyCommand@" ] [ notifyCommand ] (builtins.readFile (runtime + "/pi.ts"))
  );
  wrapHarness = harness: binary: package:
    if cfg.enable && active && notifyCfg.${harness}.enable && notifyCfg.onlyWhenUnfocused && package != null then
      pkgs.symlinkJoin ({
        name = "${package.name}-notify-focus";
        paths = [ package ];
        nativeBuildInputs = [ pkgs.makeWrapper ];
        postBuild = ''
          rm $out/bin/${binary}
          makeWrapper ${pkgs.python3}/bin/python3 $out/bin/${binary} \
            --add-flags ${runtime}/terminal.py \
            --add-flags ${package}/bin/${binary}
        '';
        meta = package.meta;
        passthru = package.passthru or { };
      } // lib.optionalAttrs (package ? version) { inherit (package) version; })
    else package;
in
{
  options.smind.hm.dev.llm.notify = {
    enable = lib.mkEnableOption "agent notifications via Matrix";
    homeserver = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "https://matrix.7mind.io";
      description = "Matrix homeserver base URL receiving agent notification messages.";
    };
    roomId = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "!abcdef:7mind.io";
      description = "Matrix room ID the notifier posts into.";
    };
    tokenFile = lib.mkOption {
      type = lib.types.nullOr (lib.types.either lib.types.str lib.types.path);
      default = null;
      example = "/run/agenix/matrix-notify-token";
      description = "File holding a Matrix access token, read at runtime so the token never lands in the store. Null disables delivery.";
    };
    minTurnSeconds = lib.mkOption {
      type = lib.types.ints.unsigned;
      default = 60;
      description = "Minimum turn duration in seconds before sending a completion notification.";
    };
    onlyWhenUnfocused = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Send notifications only when the terminal reports loss of focus or the client runs without a terminal. Unknown focus suppresses delivery with a diagnostic. Interactive clients run in a PTY to track terminal focus events.";
    };
    claude.enable = lib.mkEnableOption "Matrix agent notifications for Claude Code" // {
      default = notifyCfg.enable;
    };
    codex.enable = lib.mkEnableOption "Matrix agent notifications for Codex" // {
      default = notifyCfg.enable;
    };
    pi.enable = lib.mkEnableOption "Matrix agent notifications for Pi" // {
      default = notifyCfg.enable;
    };
  };

  options.programs = {
    claude-code.package = lib.mkOption { apply = wrapHarness "claude" "claude"; };
    codex.package = lib.mkOption { apply = wrapHarness "codex" "codex"; };
    pi.package = lib.mkOption { apply = wrapHarness "pi" "pi"; };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    {
      assertions = [
        {
          assertion = !notifyCfg.enable || active;
          message = "smind.hm.dev.llm.notify.enable needs homeserver, roomId, and tokenFile all set.";
        }
      ];
    }
    (lib.mkIf active {
      home.packages = [ notifyScript ];
      smind.hm.dev.llm.yolo.extraReadOnlyPaths = [ "${notifyCfg.tokenFile}" ];
    })
    (lib.mkIf (active && notifyCfg.claude.enable) {
      programs.claude-code.settings.hooks.UserPromptSubmit = [
        { hooks = [ { type = "command"; command = "${notifyCommand} claude --start"; } ]; }
      ];
      programs.claude-code.settings.hooks.Notification = [
        {
          matcher = "permission_prompt";
          hooks = [
            {
              type = "command";
              command = "${notifyCommand} claude --attention";
            }
          ];
        }
      ];
      programs.claude-code.settings.hooks.Stop = [
        {
          hooks = [
            {
              type = "command";
              command = "${notifyScript}/bin/agent-notify-matrix claude";
            }
          ];
        }
      ];
    })
    (lib.mkIf (active && notifyCfg.codex.enable) {
      programs.codex.settings.hooks.UserPromptSubmit = [
        { hooks = [ { type = "command"; command = "${notifyCommand} codex --start"; } ]; }
      ];
      programs.codex.settings.notify = [ notifyCommand "codex" ];
    })
    (lib.mkIf (active && notifyCfg.pi.enable) {
      programs.pi.settings.extensions = lib.mkAfter [ "${notifyExtension}" ];
    })
  ]);
}
