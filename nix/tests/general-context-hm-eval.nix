{ pkgs, nixpkgs, inputs }:
let
  lib = nixpkgs.lib;
  evaluateLLM = settings: (lib.evalModules {
    specialArgs = { inherit pkgs inputs; };
    modules = [
      (import ../hm/tools.nix { inherit inputs; })
      (import ../hm/claude.nix { inherit inputs; })
      ../hm/codex.nix
      ../hm/pi.nix
      ({ lib, ... }: {
        options.assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
        options.programs.mcp = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.programs.claude-code = lib.genAttrs
          [ "enable" "enableMcpIntegration" "skills" "context" "package" "plugins" "settings" ]
          (_: lib.mkOption { type = lib.types.anything; }) // {
            finalPackage = lib.mkOption {
              type = lib.types.package;
              default = pkgs.hello;
            };
          };
        options.smind.hm.dev.llm.yolo.configureDefaultProfile = lib.mkOption {
          type = lib.types.bool;
          default = true;
        };
        options.programs.codex = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
        options.home.file = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.home.sessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
        options.home.username = lib.mkOption { type = lib.types.str; default = "alice"; };
        options.home.homeDirectory = lib.mkOption { type = lib.types.str; default = "/home/alice"; };
        options.xdg.stateHome = lib.mkOption { type = lib.types.str; default = "/home/alice/.local/state"; };
        options.xdg.configHome = lib.mkOption { type = lib.types.str; default = "/home/alice/.config"; };
      })
      {
        smind.hm.dev.llm = {
          enable = true;
          assetBundles = [ { context = [ "integration guidance" ]; } ];
          memorySections = lib.mkAfter [ "Kai's instructions" ];
          extraSkills.sentinel = "sentinel skill";
        } // settings;
      }
    ];
  }).config;
  evaluate = settings: evaluateLLM { generalContext = settings; };
  defaults = evaluate { };
  policyConfigs = lib.genAttrs [ "no-commits" "commit-by-default" "no-preference" ]
    (commitPolicy: {
      enabled = evaluateLLM { inherit commitPolicy; };
      disabled = evaluateLLM { inherit commitPolicy; generalContext.enable = false; };
    });
  worktrees = evaluateLLM { worktrees.enable = true; };
  worktreesWithoutGeneral = evaluateLLM {
    worktrees.enable = true;
    generalContext.enable = false;
  };
  worktreeConfigs = [ worktrees worktreesWithoutGeneral ];
  invalidPolicy = evaluateLLM { commitPolicy = "commit-everything"; };
  noCommits = "Commit policy (no-commits): Do not create commits unless explicitly requested by the user. Only commit your own changes. This does not authorize pushing, force operations, or history rewriting.";
  commitByDefault = "Commit policy (commit-by-default): Commit completed, verified task changes by default unless the user says otherwise. Only commit your own changes. This does not authorize pushing, force operations, or history rewriting.";
  disabled = evaluate { enable = false; };
  withoutHammer = evaluate { sections.hammer-mode.enable = false; };
  replaced = evaluate { sections.hammer-mode.text = "Kai's replacement"; };
  reordered = evaluate { sections.tools.order = 0; };
  tied = evaluate {
    sections.hammer-mode.order = 0;
    sections.core-principles.order = 0;
  };
  customPreamble = evaluate { preamble = "Kai's guidelines"; };
  allDisabled = evaluate {
    sections = lib.genAttrs (builtins.attrNames defaults.smind.hm.dev.llm.generalContext.sections)
      (_: { enable = false; });
  };
  misspelled = evaluate { sections.hamer-mode.enable = false; };
  withoutAbrasiveLanguage = evaluate {
    sections.hammer-mode.rules.abrasive-language.enable = false;
  };
  withoutSycophancyRules = evaluate {
    sections.hammer-mode.rules.anti-sycophancy.enable = false;
  };
  withoutReproduction = evaluate {
    sections.core-principles.rules.reproduction-first.enable = false;
    sections.goal-driven-execution.rules.reproduction-first.enable = false;
    sections.reproduction-discipline.enable = false;
  };
  withoutNixStoreRule = evaluate {
    sections.tools.rules.nix-store-traversal.enable = false;
  };
  withoutSolid = evaluate { sections.code-style.rules.solid.enable = false; };
  withoutDocPaths = evaluate { sections.project-structure.rules.documentation-paths.enable = false; };
  withoutPlans = evaluate { sections.goal-driven-execution.rules.mandatory-plans.enable = false; };
  overriddenRules = evaluate {
    sections.hammer-mode = {
      text = "Kai's complete section";
      rules.abrasive-language.enable = false;
    };
  };
  misspelledRule = evaluate { sections.tools.rules.nix-store-travresal.enable = false; };
  allHammerRulesDisabled = evaluate {
    sections.hammer-mode.rules = lib.genAttrs
      (builtins.attrNames defaults.smind.hm.dev.llm.generalContext.sections.hammer-mode.rules)
      (_: { enable = false; });
  };
  parentDisabled = evaluate {
    sections.hammer-mode = {
      enable = false;
      rules.anti-sycophancy.enable = true;
    };
  };
  contexts = pkgs.callPackage ../pkg/llm-contexts/default.nix { };
  general = builtins.head defaults.smind.hm.dev.llm.memorySections;
  memory = cfg: cfg.smind.hm.dev.llm.merged.memoryText;
  before = first: second: text:
    builtins.match ".*${first}.*${second}.*" text != null;
in
assert builtins.hashString "sha256" contexts.general == "d82edc398517e05570657b6c10ca816aaf17f9f3234fd18632b8a520816246e5";
assert general == contexts.general;
assert defaults.smind.hm.dev.llm.commitPolicy == "no-preference";
assert !defaults.smind.hm.dev.llm.worktrees.enable;
assert !(lib.hasInfix "## Worktree workflow" (memory defaults));
assert lib.all (cfg:
  lib.hasInfix "## Worktree workflow" (memory cfg)
  && lib.hasInfix "git check-ignore" (memory cfg)
  && lib.hasInfix "merge the task branch back" (memory cfg)
  && lib.hasInfix "integration guidance" (memory cfg)
  && lib.hasInfix "Kai's instructions" (memory cfg)
  && cfg.smind.hm.dev.llm.commitPolicy == "no-preference"
) worktreeConfigs;
assert !(lib.hasInfix "# Project Guidelines" (memory worktreesWithoutGeneral));
assert memory defaults == general + "\n\nintegration guidance\n\nKai's instructions";
assert memory disabled == "integration guidance\n\nKai's instructions";
assert memory policyConfigs.no-commits.enabled == general + "\n\n${noCommits}\n\nintegration guidance\n\nKai's instructions";
assert memory policyConfigs.no-commits.disabled == "${noCommits}\n\nintegration guidance\n\nKai's instructions";
assert memory policyConfigs.commit-by-default.enabled == general + "\n\n${commitByDefault}\n\nintegration guidance\n\nKai's instructions";
assert memory policyConfigs.commit-by-default.disabled == "${commitByDefault}\n\nintegration guidance\n\nKai's instructions";
assert memory policyConfigs.no-preference.enabled == general + "\n\nintegration guidance\n\nKai's instructions";
assert memory policyConfigs.no-preference.disabled == "integration guidance\n\nKai's instructions";
assert !(builtins.tryEval (memory invalidPolicy)).success;
assert disabled.smind.hm.dev.llm.merged.skills == defaults.smind.hm.dev.llm.merged.skills;
assert disabled.smind.hm.dev.llm.merged.skills.sentinel == "sentinel skill";
assert !(lib.hasInfix "Hammer Mode" (memory withoutHammer));
assert lib.hasInfix "## 2. Core Principles" (memory withoutHammer);
assert lib.hasInfix "integration guidance" (memory withoutHammer);
assert !(lib.hasInfix "Hammer Mode" (memory replaced));
assert lib.hasInfix "Kai's replacement" (memory replaced);
assert before "## 10. Tools" "## 1. Hammer Mode" (memory reordered);
assert before "## 2. Core Principles" "## 1. Hammer Mode" (memory tied);
assert lib.hasPrefix "Kai's guidelines\n\n## 1. Hammer Mode" (memory customPreamble);
assert !(lib.hasInfix "# Project Guidelines" (memory customPreamble));
assert !(lib.hasInfix "## " (memory allDisabled));
assert !(builtins.tryEval (memory misspelled)).success;
assert !(lib.hasInfix "abrasive responses" (memory withoutAbrasiveLanguage));
assert lib.hasInfix "Epistemic discipline" (memory withoutAbrasiveLanguage);
assert !(lib.hasInfix "Reduce sycophancy" (memory withoutSycophancyRules));
assert !(lib.hasInfix "mirror the user's enthusiasm" (memory withoutSycophancyRules));
assert lib.hasInfix "Epistemic discipline" (memory withoutSycophancyRules);
assert !(lib.hasInfix "No repro, no fix" (memory withoutReproduction));
assert !(lib.hasInfix "reproduce the failure" (memory withoutReproduction));
assert !(lib.hasInfix "Reproduction Discipline" (memory withoutReproduction));
assert lib.hasInfix "Test before done" (memory withoutReproduction);
assert !(lib.hasInfix "Nix store discipline" (memory withoutNixStoreRule));
assert lib.hasInfix "Worktrees for parallel edits" (memory withoutNixStoreRule);
assert !(lib.hasInfix "SOLID" (memory withoutSolid));
assert lib.hasInfix "Type safety" (memory withoutSolid);
assert !(lib.hasInfix "docs/drafts/" (memory withoutDocPaths));
assert lib.hasInfix "Debug scripts" (memory withoutDocPaths);
assert !(lib.hasInfix "state a brief plan" (memory withoutPlans));
assert lib.hasInfix "Transform tasks into verifiable goals" (memory withoutPlans);
assert lib.hasInfix "Kai's complete section" (memory overriddenRules);
assert !(lib.hasInfix "Epistemic discipline" (memory overriddenRules));
assert !(builtins.tryEval (memory misspelledRule)).success;
assert allHammerRulesDisabled.smind.hm.dev.llm.generalContext.sections.hammer-mode.text == "## 1. Hammer Mode\n\n";
assert memory parentDisabled == memory withoutHammer;
assert lib.all (cfg:
  cfg.programs.claude-code.context == memory cfg
  && cfg.programs.codex.context == memory cfg
  && cfg.programs.pi.context == memory cfg
) ([ defaults disabled withoutHammer replaced reordered withoutAbrasiveLanguage withoutReproduction withoutNixStoreRule ]
  ++ worktreeConfigs
  ++ lib.concatMap (configs: [ configs.enabled configs.disabled ]) (lib.attrValues policyConfigs));
pkgs.runCommandLocal "general-context-hm-eval-test" {
  passthru.testTaxonomy = {
    purpose = "behavioral";
    status = "active";
    encapsulation = "blackbox";
    isolation = "group";
    origin = "specified";
  };
} "touch $out"
