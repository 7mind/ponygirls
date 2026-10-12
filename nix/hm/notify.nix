{ config, lib, pkgs, ... }:
let
  cfg = config.smind.hm.dev.llm;
  notifyCfg = cfg.notify;
  transportE2EE = notifyCfg.transport == "e2ee";
  active =
    notifyCfg.enable
    && notifyCfg.homeserver != null
    && notifyCfg.roomId != null
    && (transportE2EE || notifyCfg.tokenFile != null);
  runtime = ../pkg/agent-notify;
  e2eEnv = pkgs.python3.withPackages (ps: [ ps.matrix-nio ps.vodozemac ps.cachetools ps.atomicwrites ps.peewee ]);
  settings = pkgs.writeText "agent-notify-matrix.json" (builtins.toJSON {
    inherit (notifyCfg) homeserver roomId tokenFile minTurnSeconds;
    inherit (notifyCfg) transport sender passwordFile;
    inherit (notifyCfg) includeMessageBody includeWorkdir includeHostname;
  });
  notifyScript = pkgs.writeShellScriptBin "agent-notify-matrix" ''
    export PYTHONPATH="${e2eEnv}/${pkgs.python3.sitePackages}''${PYTHONPATH:+:$PYTHONPATH}"
    exec ${pkgs.python3}/bin/python3 ${runtime}/notify.py ${settings} "$@"
  '';
  notifyCommand = "${notifyScript}/bin/agent-notify-matrix";
  notifyExtension = pkgs.writeText "ponygirls-agent-notify-matrix.ts" (
    lib.replaceStrings [ "@notifyCommand@" ] [ notifyCommand ] (builtins.readFile (runtime + "/pi.ts"))
  );
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
    transport = lib.mkOption {
      type = lib.types.enum [ "plaintext" "e2ee" ];
      default = "plaintext";
      description = "Matrix delivery transport. Plaintext posts raw events with tokenFile and needs no setup. E2EE encrypts via matrix-nio with per-host provisioning (agent-notify-matrix --setup plus one device verification in Element); the key store lives under ~/.local/share/agent-notify-matrix and is bound into the sandbox, so XDG_DATA_HOME overrides need manual binding.";
    };
    sender = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "@kai-notifier:matrix.org";
      description = "Full user ID of the notifier account for e2ee transport. Used at setup; runtime restores credentials from the provisioned store. Null prompts interactively during setup.";
    };
    passwordFile = lib.mkOption {
      type = lib.types.nullOr (lib.types.either lib.types.str lib.types.path);
      default = null;
      example = "/run/agenix/matrix-notify-password";
      description = "File holding the notifier account password, read only by one-time e2ee setup so it never lands in the store. Null prompts interactively during setup.";
    };
    minTurnSeconds = lib.mkOption {
      type = lib.types.ints.unsigned;
      default = 60;
      description = "Minimum turn duration in seconds before sending a completion notification.";
    };
    includeMessageBody = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Append the triggering message text, truncated to 200 characters, to notifications. Requires e2ee transport: message content never travels unencrypted.";
    };
    includeWorkdir = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Append the agent working directory to notifications.";
    };
    includeHostname = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Append the notifying machine hostname to notifications. The name is read at runtime, so roaming hosts report correctly.";
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

  config = lib.mkIf cfg.enable (lib.mkMerge [
    {
      assertions = [
        {
          assertion = !notifyCfg.enable || (notifyCfg.homeserver != null && notifyCfg.roomId != null);
          message = "smind.hm.dev.llm.notify.enable needs homeserver and roomId set.";
        }
        {
          assertion = !(notifyCfg.enable && notifyCfg.transport == "plaintext") || notifyCfg.tokenFile != null;
          message = "smind.hm.dev.llm.notify plaintext transport needs tokenFile set.";
        }
        {
          assertion = !(notifyCfg.enable && notifyCfg.includeMessageBody) || notifyCfg.transport == "e2ee";
          message = "smind.hm.dev.llm.notify includeMessageBody needs transport = \"e2ee\".";
        }
      ];
    }
    (lib.mkIf active {
      home.packages = [ notifyScript ];
      smind.hm.dev.llm.yolo.extraReadOnlyPaths = lib.optional (notifyCfg.tokenFile != null) "${notifyCfg.tokenFile}";
      smind.hm.dev.llm.yolo.extraReadWritePaths = lib.optional (notifyCfg.transport == "e2ee") "${config.home.homeDirectory}/.local/share/agent-notify-matrix";
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
