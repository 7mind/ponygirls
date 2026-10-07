{ config, lib, pkgs, ... }:
let
  cfg = config.smind.hm.dev.llm;
  notifyCfg = cfg.notify;
  active =
    notifyCfg.enable
    && notifyCfg.homeserver != null
    && notifyCfg.roomId != null
    && notifyCfg.tokenFile != null;
  notifyScript = pkgs.writeShellScriptBin "agent-notify-matrix" ''
    set -eu
    printf '\a'
    HARNESS="''${1:-agent}"
    SESSION="''${2:-}"
    CWD_RAW="''${3:-}"
    INPUT=""
    if [ ! -t 0 ]; then
      INPUT=$(head -c 8192 2>/dev/null || true)
    fi
    for a in "$@"; do
      case "$a" in
        '{'*) INPUT=$a ;;
      esac
    done
    HOOK_SESSION=$(printf '%s' "$INPUT" | ${pkgs.jq}/bin/jq -r '.session_id // .sessionId // .thread_id // ."thread-id" // empty' 2>/dev/null || true)
    HOOK_MSG=$(printf '%s' "$INPUT" | ${pkgs.jq}/bin/jq -r '.message // .title // ."last-assistant-message" // empty' 2>/dev/null | head -c 200 || true)
    if [ -z "$CWD_RAW" ]; then
      CWD_RAW=$(printf '%s' "$INPUT" | ${pkgs.jq}/bin/jq -r '.cwd // empty' 2>/dev/null || true)
    fi
    case "$SESSION" in
      '{'*) SESSION="" ;;
    esac
    if [ -z "$SESSION" ]; then
      SESSION=$HOOK_SESSION
    fi
    case "$SESSION" in
      ????????-????-????-????-????????????) SESSION="''${SESSION:0:8}" ;;
    esac
    TAG="$HARNESS"
    if [ -n "$CWD_RAW" ]; then
      TAG="$TAG/''${CWD_RAW##*/}"
    fi
    BODY="agent: input needed [$TAG]"
    if [ -n "$SESSION" ]; then
      BODY="$BODY ''${SESSION:0:64}"
    fi
    if [ -n "$HOOK_MSG" ]; then
      BODY="$BODY: $HOOK_MSG"
    fi
    TOKEN=$(cat ${lib.escapeShellArg "${notifyCfg.tokenFile}"})
    PAYLOAD=$(${pkgs.jq}/bin/jq -n --arg body "$BODY" '{msgtype: "m.text", body: $body}')
    TXN="$(date +%s%N)-$RANDOM"
    ${pkgs.curl}/bin/curl -s --max-time 10 -X PUT \
      "${notifyCfg.homeserver}/_matrix/client/v3/rooms/${notifyCfg.roomId}/send/m.room.message/$TXN" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" > /dev/null || true
  '';
  notifyExtension = pkgs.writeText "ponygirls-agent-notify-matrix.ts" ''
    import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
    import { execFile } from "node:child_process";
    export default function (pi: ExtensionAPI) {
      pi.on("agent_settled", async (_event, ctx) => {
        let session = "";
        try {
          session = ctx.sessionManager.getSessionName() || ctx.sessionManager.getSessionId() || "";
        } catch {
          session = "";
        }
        const args = ["pi", session, process.cwd()];
        execFile("${notifyScript}/bin/agent-notify-matrix", args, { stdio: "ignore" }, (error) => {
          if (error) console.error("[agent-notify-matrix] failed: " + error.message);
        });
      });
    }
  '';
in
{
  options.smind.hm.dev.llm.notify = {
    enable = lib.mkEnableOption "agent notifications via Matrix";
    homeserver = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "https://matrix.7mind.io";
      description = "Matrix homeserver base URL receiving input-needed messages.";
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
      programs.claude-code.settings.hooks.Notification = [
        {
          matcher = "permission_prompt|idle_prompt";
          hooks = [
            {
              type = "command";
              command = "${notifyScript}/bin/agent-notify-matrix claude";
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
      programs.codex.settings.notify = [ "${notifyScript}/bin/agent-notify-matrix" "codex" ];
    })
    (lib.mkIf (active && notifyCfg.pi.enable) {
      programs.pi.settings.extensions = lib.mkAfter [ "${notifyExtension}" ];
    })
  ]);
}
