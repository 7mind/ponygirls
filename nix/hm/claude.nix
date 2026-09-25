# Claude Code configuration for the LLM coding-agent harness, split out of
# dev-llm.nix. Configures the (downstream-provided) `programs.claude-code`
# module; the shared skill/context bundles / MCP registry / merged views come
# from the sibling tools.nix via `smind.hm.dev.llm.{enable,merged.*,…}`.
{ inputs }:
{ config
, lib
, pkgs
, ...
}:
let
  cfg = config.smind.hm.dev.llm;
  codexPluginCc = inputs.openai-codex-plugin;

  # claude-code pinned to the local native-tarball build (../pkg/claude-code),
  # built directly so the module does not depend on a consumer overlay. The
  # package is self-contained per platform (on Linux it patches PT_INTERP and
  # execs the inner binary directly so process.execPath stays the real binary;
  # Darwin needs nothing extra) — the execpath rationale lives in package.nix's
  # postFixup.
  claudePkg = pkgs.callPackage ../pkg/claude-code/package.nix { };

  # SessionStart hook: surfaces the hostname on every session boot. Claude
  # Code's injected environment block lists OS/shell/cwd but not hostname, so
  # without this the model guesses (and tends to assume the wrong host). Sandbox
  # state is no longer reported here — it is a yolo concern, declared as a yolo
  # promptExtension (the "Sandbox: ACTIVE …" note in nix/hm/yolo.nix) which is
  # injected exactly when running under the wrapper that sets SMIND_SANDBOXED.
  claudeSessionStartHook = pkgs.writeShellScript "claude-session-start-context" ''
    set -eu
    HOST="''${HOSTNAME:-$(hostname 2>/dev/null || echo unknown)}"
    printf '%s\n' \
      'Runtime environment (injected by SessionStart hook):' \
      "- Hostname: $HOST. Use this exact value where CLAUDE.md or scripts reference the current host; do not rely on \$HOSTNAME (zsh, the user's login shell, does not export it)."
  '';

  # Wiring common to every skill-aware harness: enable it, feed the shared
  # programs.mcp registry, install the merged skill set, and the shared memory
  # text. Spread with `//` into the programs.claude-code block (no key overlap).
  sharedAgentWiring = {
    enable = true;
    enableMcpIntegration = true;
    skills = cfg.merged.skills;
    context = cfg.merged.memoryText;
  };
in
{
  options.smind.hm.dev.llm.openaiCodexPlugin.enable =
    lib.mkEnableOption "the OpenAI Codex plugin for Claude Code" // { default = false; };

  config = lib.mkIf cfg.enable {
    programs.claude-code = sharedAgentWiring // {
      # Bake DISABLE_AUTOUPDATER into the wrapper so it survives downstream
      # wrappers (yolo, bubblewrap, fresh-env exec) and Claude Code can't
      # self-update past the nix pin.
      package = lib.mkDefault (pkgs.symlinkJoin {
        name = "claude-code-no-autoupdate";
        inherit (claudePkg) version;
        paths = [ claudePkg ];
        nativeBuildInputs = [ pkgs.makeWrapper ];
        postBuild = ''
          wrapProgram $out/bin/claude \
            --set-default DISABLE_AUTOUPDATER 1
        '';
      });
      plugins = lib.optionalAttrs cfg.openaiCodexPlugin.enable {
        codex = "${codexPluginCc}/plugins/codex";
      };
      settings = {
        alwaysThinkingEnabled = true;
        theme = "dark";
        # Workaround for Claude Code 2.1.83+ regression where sandbox
        # detection fails even when bubblewrap/socat are on PATH (the
        # error reads "sandbox required but unavailable: ${j$}").
        sandbox = {
          failIfUnavailable = false;
        };
        tui = lib.mkIf cfg.fullscreenTui.enable "fullscreen";
        permissions = {
          allow = [ "Edit(/tmp/**)" ];
          # defaultMode = "bypassPermissions";  # commented out: this controls *permission prompts* (file edits etc.), not the AskUserQuestion tool
          # Disable the AskUserQuestion tool (the interactive multiple-choice "ask user" / question UI).
          # Tool name from https://code.claude.com/docs/en/tools-reference ; see also GitHub #10258.
          deny = [ "AskUserQuestion" ];
        };
        includeCoAuthoredBy = cfg.coAuthored.enable;
        attribution = lib.mkIf (!cfg.coAuthored.enable) { commit = ""; pr = ""; };
        effortLevel = cfg.models.claude.effort;
        model = cfg.models.claude.model;
        spinnerVerbs = {
          mode = "replace";
          verbs = [ "Working" ];
        };
        hooks = {
          # Inject hostname + sandbox state into every session. See
          # claudeSessionStartHook above for rationale.
          SessionStart = [
            {
              matcher = "*";
              hooks = [
                {
                  type = "command";
                  command = "${claudeSessionStartHook}";
                }
              ];
            }
          ];
        };
        statusLine = {
          "type" = "command";
          "command" = ''
            CLAUDE_ACCOUNT="$(${pkgs.jq}/bin/jq -r '
              .oauthAccount.emailAddress //
              .oauthAccount.email //
              .oauthAccount.account.emailAddress //
              .oauthAccount.account.email //
              .oauthAccount.name //
              .oauthAccount.displayName //
              .oauthAccount.accountName //
              .account.emailAddress //
              .account.email //
              .account.name //
              empty
            ' "$HOME/.claude.json" 2>/dev/null)"
            if [ -z "$CLAUDE_ACCOUNT" ]; then
              CLAUDE_ACCOUNT="unknown-claude-account"
            fi
            printf '\033[2m\033[35m%s \033[0m\033[2m\033[37m%s \033[0m\033[2m@ %s \033[0m\033[2m\033[36min \033[1m\033[36m%s\033[0m' "$CLAUDE_ACCOUNT" "$(whoami)" "$(hostname -s)" "$(pwd | sed "s|^$HOME|~|")"
          '';
        };
      };
    };

    # Mirror the HM-managed Claude settings + memory to a `.claude-work`
    # profile path so yolo's `--work`/`--profile work` namespace re-shares
    # them.
    home.file.".claude-work/settings.json".source =
      config.home.file."${config.programs.claude-code.configDir}/settings.json".source;
    home.file.".claude-work/CLAUDE.md".source =
      config.home.file."${config.programs.claude-code.configDir}/CLAUDE.md".source;
  };
}
