# Reusable shared infrastructure for the LLM coding-agent harness, split out of
# dev-llm.nix. Owns the cross-agent surface that the per-agent modules
# (claude.nix / codex.nix / pi.nix) and the sandbox (yolo.nix) build on:
#
#   * the master `smind.hm.dev.llm.enable` switch,
#   * the contributed-asset-bundle merge (skills/commands/agents/context) and
#     the read-only `smind.hm.dev.llm.merged.*` views the agent modules consume,
#   * the shared `programs.mcp` registry, and
#   * the common host packages (gh, node, codegraph, sandbox glue).
#
# Curried over the flake's `inputs` (codegraph, claude-code-sandbox).
{ inputs }:
{ config
, lib
, pkgs
, ...
}:
let
  system = pkgs.stdenv.hostPlatform.system;
  isLinux = pkgs.stdenv.hostPlatform.isLinux;
  isDarwin = pkgs.stdenv.hostPlatform.isDarwin;

  codegraphPkg = pkgs.callPackage ../pkg/codegraph/package.nix {
    src = inputs.codegraph;
  };

  # Prompt content lives in two sibling packages: pkg/llm-skills (SKILL.md set
  # + build-time validation) and pkg/llm-contexts (general context + Pi's
  # operating manual). Environment guidance is a skill for skill-aware agents;
  # skill-less agents (consumers that can't load SKILL.md trees) get the
  # pre-composed llm-context-with-env.
  llmSkills = pkgs.callPackage ../pkg/llm-skills/default.nix { };
  llmContexts = pkgs.callPackage ../pkg/llm-contexts/default.nix { };

  # Canonical llmAssets bundle from the two in-repo packages: skills from
  # llm-skills, general context from llm-contexts. Symmetric with
  # external llmAssets bundles. This base bundle has no commands or agents.
  llmPromptsBundle = {
    skills = llmSkills.skills;
    commands = { };
    agents = { };
    context = [ llmContexts.general ];
  };

  # Aggregate every contributed asset bundle into one merged view. Mirrors
  # the memorySections list-contribution idiom: any module/flake appends a
  # bundle to smind.hm.dev.llm.assetBundles and the materializer below fans
  # it into every agent. Later bundles win on key collisions (`//`).
  assetBundles = config.smind.hm.dev.llm.assetBundles;
  mergeAttrField = field: lib.foldl' (acc: b: acc // b.${field}) { } assetBundles;
  mergedSkills = mergeAttrField "skills";
  mergedCommands = mergeAttrField "commands";
  mergedAgents = mergeAttrField "agents";
  mergedContext = lib.concatMap (b: b.context) assetBundles;
  claudeMemoryText = lib.concatStringsSep "\n\n" config.smind.hm.dev.llm.memorySections;

  # Command bundles key entries as "<ns>/<name>" (e.g. "plan/advance").
  # Slash-prompt harnesses (Pi, Codex) discover templates from a flat,
  # non-recursive directory and derive the command name from the filename stem,
  # so "/" must fold into a separator surviving as one token. ":" matches
  # Claude's namespaced slash commands (/plan:advance) and keeps distinct keys
  # distinct (plain baseNameOf collapses plan/advance, implement/advance,
  # investigate/advance onto one "advance.md"). Pi's harness applies the same
  # transform internally (see mk-agent-harness).
  commandKeyToStem = key: lib.replaceStrings [ "/" ] [ ":" ] key;
in
{
  options = {
    smind.hm.dev.llm.enable = lib.mkEnableOption "LLM development environment variables";

    # Read-only views of the merged asset bundles, exposed so sibling modules
    # can reuse the same skill set and memory text without re-folding
    # `assetBundles`/`memorySections`.
    smind.hm.dev.llm.merged.skills = lib.mkOption {
      type = lib.types.attrsOf lib.types.lines;
      readOnly = true;
      description = "Merged skill set across all contributed asset bundles.";
    };

    smind.hm.dev.llm.merged.commands = lib.mkOption {
      type = lib.types.attrsOf lib.types.lines;
      readOnly = true;
      description = "Merged slash-command set across all contributed bundles.";
    };

    smind.hm.dev.llm.merged.agents = lib.mkOption {
      type = lib.types.attrsOf lib.types.lines;
      readOnly = true;
      description = "Merged subagent set across all contributed bundles.";
    };

    smind.hm.dev.llm.merged.memoryText = lib.mkOption {
      type = lib.types.lines;
      readOnly = true;
      description = "Concatenated Claude/Codex/Pi memory text (AGENTS.md).";
    };

    smind.hm.dev.llm.memorySections = lib.mkOption {
      type = lib.types.listOf lib.types.lines;
      default = [ ];
      description = "Sections used to build Claude/Codex memory text.";
    };

    smind.hm.dev.llm.assetBundles = lib.mkOption {
      type = lib.types.listOf (
        lib.types.submodule {
          # Producers may carry a richer payload than this materializer fans
          # out. The four fields below stay typed; the freeform type lets a
          # producer contract grow without breaking older consumers.
          freeformType = lib.types.attrsOf lib.types.anything;
          options = {
            skills = lib.mkOption {
              type = lib.types.attrsOf lib.types.lines;
              default = { };
              description = "name -> SKILL.md content ('---\\nmeta---\\n\\ncontent').";
            };
            commands = lib.mkOption {
              type = lib.types.attrsOf lib.types.lines;
              default = { };
              description = "key '<ns>/<name>' -> markdown body (slash command /<ns>:<name>).";
            };
            agents = lib.mkOption {
              type = lib.types.attrsOf lib.types.lines;
              default = { };
              description = "name -> subagent definition (with name/description/tools frontmatter).";
            };
            context = lib.mkOption {
              type = lib.types.listOf lib.types.lines;
              default = [ ];
              description = "CLAUDE.md/AGENTS.md memory fragments.";
            };
          };
        }
      );
      default = [ ];
      description = ''
        Contributed LLM asset bundles (cross-repo llmAssets shape). Any
        module or flake appends a bundle here; a single materializer fans
        every asset type (skills, commands, agents, context) into every
        agent's filesystem layout globally. Mirrors the memorySections
        list-contribution idiom.
      '';
    };

    # End-user escape hatch for custom skills. `assetBundles` is the
    # module/flake contribution idiom (append a full bundle); this option is
    # the ergonomic path when a host just wants to drop one or more SKILL.md
    # bodies onto every skill-aware agent without constructing a bundle.
    # Wired as a late asset bundle so user names win on collision with the
    # in-repo and externally contributed skill sets.
    smind.hm.dev.llm.extraSkills = lib.mkOption {
      type = lib.types.attrsOf lib.types.lines;
      default = { };
      example = {
        my-domain = ''
          ---
          name: my-domain
          description: >-
            Domain rules for our internal widgets. Invoke ONLY when the user
            references this skill by name (e.g. "/my-domain").
          ---

          # My domain skill

          …
        '';
      };
      description = ''
        Extra user-defined skills merged into every skill-aware agent
        (Claude / Codex / Pi). Each attribute name is the skill directory
        name; each value is a full SKILL.md body
        (`---\n<meta.yaml fields>---\n\n<content>`).

        Prefer this over appending a one-off entry to `assetBundles` when you
        only need skills. Values may be inline strings or
        `builtins.readFile ./path/to/SKILL.md`. On name collision with an
        in-repo or externally contributed skill, the entry here wins.
      '';
    };

    smind.hm.dev.llm.coAuthored.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Include Co-Authored-By: <llm> in commit message";
    };

    smind.hm.dev.llm.fullscreenTui.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Enable fullscreen TUI mode for agent CLIs that support it";
    };

    smind.hm.dev.llm.models.claude.model = lib.mkOption {
      type = lib.types.str;
      default = "opus";
      description = "Claude Code default model; the opus alias tracks the current Opus release.";
    };

    smind.hm.dev.llm.models.claude.effort = lib.mkOption {
      type = lib.types.enum [ "auto" "low" "medium" "high" "xhigh" "max" ];
      default = "high";
      description = "Claude Code default effort level.";
    };

    smind.hm.dev.llm.models.codex.model = lib.mkOption {
      type = lib.types.str;
      default = "gpt-6-sol";
      description = "Codex default model.";
    };

    smind.hm.dev.llm.models.codex.reasoningEffort = lib.mkOption {
      type = lib.types.enum [ "minimal" "low" "medium" "high" "xhigh" ];
      default = "medium";
      description = "Codex default model reasoning effort.";
    };

    smind.hm.dev.llm.models.pi.provider = lib.mkOption {
      type = lib.types.str;
      default = "xiaomi-token-plan-ams";
      description = "Pi default inference provider.";
    };

    smind.hm.dev.llm.models.pi.model = lib.mkOption {
      type = lib.types.str;
      default = "mimo-v2.6-pro";
      description = "Pi default model.";
    };

    smind.hm.dev.llm.models.pi.thinkingLevel = lib.mkOption {
      type = lib.types.enum [ "off" "minimal" "low" "medium" "high" "xhigh" "max" ];
      default = "xhigh";
      description = "Pi default thinking level for reasoning-capable models.";
    };
  };

  config = lib.mkMerge [
    {
      # Read-only merged views for sibling modules to reuse.
      smind.hm.dev.llm.merged = {
        skills = mergedSkills;
        commands = mergedCommands;
        agents = mergedAgents;
        memoryText = claudeMemoryText;
      };
      # Base context (and any other bundle context fragments) flow in via the
      # asset bundles; mkBefore keeps them ahead of host/user-specific
      # sections appended elsewhere with mkAfter.
      smind.hm.dev.llm.memorySections = lib.mkBefore mergedContext;
      # In-repo prompts form the base. External modules append their bundles.
      smind.hm.dev.llm.assetBundles = lib.mkBefore [ llmPromptsBundle ];
    }
    # User extraSkills last so host-local names win on collision. Separate
    # mkMerge arm: two assignments to the same attr in one set are illegal
    # even with mkBefore/mkAfter. Only emit the bundle when non-empty.
    {
      smind.hm.dev.llm.assetBundles = lib.mkAfter (
        lib.optional (config.smind.hm.dev.llm.extraSkills != { }) {
          skills = config.smind.hm.dev.llm.extraSkills;
        }
      );
    }
    (lib.mkIf config.smind.hm.dev.llm.enable {
      # commandKeyToStem ("/"→":") is injective only while no two bundle keys
      # share a stem. Fail-fast if a future bundle introduces a collision
      # (e.g. "a/b" and "a:b"), which would otherwise silently overwrite one
      # slash-prompt for Pi and Codex.
      assertions =
        let
          keys = builtins.attrNames mergedCommands;
          stemOf = lib.groupBy commandKeyToStem keys;
          collisions = lib.filterAttrs (_stem: ks: lib.length ks > 1) stemOf;
        in
        [
          {
            assertion = collisions == { };
            message =
              "smind.hm.dev.llm: command bundle keys collide after commandKeyToStem "
              + "('/'→':'): "
              + lib.concatStringsSep "; " (
                lib.mapAttrsToList (stem: ks: "${stem} ⇐ ${lib.concatStringsSep ", " ks}") collisions
              );
          }
        ];

      # CodeGraph MCP server — declared once, pulled into each agent CLI via
      # its enableMcpIntegration option below. Started on-demand per project by
      # the agent. Yolo builds the per-project index in its sandbox pre-start
      # hook; outside yolo, initialize it manually with `codegraph init`.
      programs.mcp = {
        enable = true;
        servers.codegraph = {
          command = "${codegraphPkg}/bin/codegraph";
          args = [ "serve" "--mcp" ];
        };
      };

      # Shared host packages. The bubblewrap sandbox + `yolo` wrapper live in
      # the sibling yolo.nix module; reattach-llm is a Linux-only tmux reattach
      # helper for the agent terminals (not a sandbox concern, so it stays here).
      home.packages = [
        pkgs.gh
        pkgs.nodejs # required by claude-code plugins (.mjs scripts)
        codegraphPkg # codegraph CLI on the host PATH (the per-project index
        # bootstrap inside yolo is a pre-start hook; see nix/hm/yolo.nix)
      ] ++ lib.optionals isDarwin [
        inputs.claude-code-sandbox.packages.${system}.default
      ]
      ++ lib.optionals isLinux [
        (pkgs.callPackage ../pkg/reattach-llm/default.nix { })
      ];
    })
  ];
}
