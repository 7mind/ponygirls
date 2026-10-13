# yolo forge-token Home Manager eval test.
#
# Pure evaluation of nix/hm/yolo.nix `forgeTokens`: per-token secret
# injection under the resolved env-var names (forge default, derived
# per-account, explicit override), the generated prompt fragments (identity,
# targets + operations scope, instance-appropriate CLI/API usage, free-form
# policy), the shared confidentiality fragment, suppression tags + `when`,
# and the fail-fast assertions (duplicate env vars, two defaults per forge,
# forge-mismatched operations, empty operations, malformed account/repo
# names, validated-var collision). Linux + Darwin parity: both wrappers
# consume the same fragments and secret map.
{ pkgs, nixpkgs, yoloHmModule }:
let
  lib = nixpkgs.lib;

  # Minimal downstream stubs (mirrors nix/tests/manure-hm-stub.nix): the yolo
  # module declares every smind.hm.dev.llm.yolo.* option itself, so only the
  # HM leaves it writes to are stubbed here.
  stub = { lib, ... }: {
    options.assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
    options.smind.hm.dev.llm.enable = lib.mkOption { type = lib.types.bool; default = false; };
    options.smind.hm.dev.llm.assetBundles = lib.mkOption { type = lib.types.listOf lib.types.anything; default = [ ]; };
    options.smind.hm.dev.llm.memorySections = lib.mkOption { type = lib.types.listOf lib.types.str; default = [ ]; };
    options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
    options.home.sessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
    options.home.username = lib.mkOption { type = lib.types.str; default = "alice"; };
    options.home.homeDirectory = lib.mkOption { type = lib.types.str; default = "/home/alice"; };
    options.xdg.stateHome = lib.mkOption { type = lib.types.str; default = "/home/alice/.local/state"; };
    options.xdg.configHome = lib.mkOption { type = lib.types.str; default = "/home/alice/.config"; };
  };

  evalYolo = sys: configModule: nixpkgs.lib.evalModules {
    specialArgs = { pkgs = import nixpkgs { system = sys; }; };
    modules = [ yoloHmModule stub configModule ];
  };

  mkToken = extra: { account = "t"; forge = "github"; tokenFile = "/run/agenix/t"; operations = [ "read" ]; } // extra;
  negConfig = tokens: { ... }: {
    config.smind.hm.dev.llm.yolo = {
      codegraph = null;
      forgeTokens = tokens;
    };
  };

  happyConfig = { ... }: {
    config.smind.hm.dev.llm.yolo = {
      codegraph = null;
      secretSessionVariables.OPENROUTER_API_KEY = "/run/agenix/openrouter";
      validatedSessionVariables.HAYSTACK_TOKEN = "/run/secrets/haystack-token";
      forgeTokens = [
        {
          account = "autopeasant";
          forge = "github";
          tokenFile = "/run/agenix/github-token-autopeasant";
          default = true;
          targets.publicOnly = true;
          operations = [ "read" "issues" "pull-requests" ];
          policy = "AUTONOMOUS-FILING POLICY";
        }
        {
          account = "acme";
          forge = "github";
          tokenFile = "/run/agenix/github-token-acme";
          targets.orgs = [ "acme" ];
          operations = [ "read" "issues" "pull-requests" ];
          policy = "COMPANY POLICY";
        }
        {
          account = "acme";
          forge = "gitlab";
          tokenFile = "/run/agenix/gitlab-token-acme";
          instance = "gitlab.acme.example";
          targets.repos = [ "acme/backend" ];
          operations = [ "read" "issues" "merge-requests" ];
          policy = "GITLAB POLICY";
        }
      ];
    };
  };

  explicitConfig = { ... }: {
    config.smind.hm.dev.llm.yolo = {
      codegraph = null;
      forgeTokens = [ (mkToken { account = "work"; envVar = "GH_WORK_TOKEN"; }) ];
    };
  };

  collisionConfig = { ... }: {
    config.smind.hm.dev.llm.yolo = {
      codegraph = null;
      validatedSessionVariables.HAYSTACK_TOKEN = "/run/secrets/haystack-token";
      forgeTokens = [ (mkToken { envVar = "HAYSTACK_TOKEN"; }) ];
    };
  };

  fragment = mod: tags:
    lib.findFirst (f: f.tags == tags)
      (throw "yolo-forge-tokens-eval: no fragment with tags [ ${builtins.concatStringsSep " " tags} ]")
      mod.config.smind.hm.dev.llm.yolo.promptExtensions;

  failedWith = needle: mod:
    lib.any (a: !a.assertion && lib.hasInfix needle a.message) mod.config.assertions;

  linux = evalYolo "x86_64-linux" happyConfig;
  darwin = evalYolo "aarch64-darwin" happyConfig;
  explicit = evalYolo "x86_64-linux" explicitConfig;
  secrets = linux.config.smind.hm.dev.llm.yolo.secretSessionVariables;
  autopeasant = fragment linux [ "forge" "github" "autopeasant" ];
  acmeGh = fragment linux [ "forge" "github" "acme" ];
  acmeGl = fragment linux [ "forge" "gitlab" "acme" ];
  shared = fragment linux [ "forge" ];

  twoDefaults = evalYolo "x86_64-linux" (negConfig [ (mkToken { account = "a"; default = true; }) (mkToken { account = "b"; default = true; }) ]);
  dupEnv = evalYolo "x86_64-linux" (negConfig [ (mkToken { account = "a"; envVar = "GH_X_TOKEN"; }) (mkToken { account = "b"; envVar = "GH_X_TOKEN"; }) ]);
  wrongForgeOps = evalYolo "x86_64-linux" (negConfig [ (mkToken { operations = [ "merge-requests" ]; }) ]);
  badAccount = evalYolo "x86_64-linux" (negConfig [ (mkToken { account = "bad account"; envVar = "GH_BAD_TOKEN"; }) ]);
  badRepo = evalYolo "x86_64-linux" (negConfig [ (mkToken { targets.repos = [ "a/b/c" ]; }) ]);
  emptyOps = evalYolo "x86_64-linux" (negConfig [ (mkToken { operations = [ ]; }) ]);
  collision = evalYolo "x86_64-linux" collisionConfig;
in
# Secret transport: forge-default, derived per-account and plain secrets
# share one map; the validated map stays separate.
assert secrets == {
  OPENROUTER_API_KEY = "/run/agenix/openrouter";
  GH_TOKEN = "/run/agenix/github-token-autopeasant";
  GH_ACME_TOKEN = "/run/agenix/github-token-acme";
  GITLAB_ACME_TOKEN = "/run/agenix/gitlab-token-acme";
};
assert linux.config.smind.hm.dev.llm.yolo.validatedSessionVariables == { HAYSTACK_TOKEN = "/run/secrets/haystack-token"; };
# An explicit envVar overrides the derived name.
assert explicit.config.smind.hm.dev.llm.yolo.secretSessionVariables == { GH_WORK_TOKEN = "/run/agenix/t"; };
# Per-token fragment: identity, scope, operations, usage, policy.
assert lib.hasInfix ''Forge token "autopeasant" (GitHub, github.com): the GH_TOKEN environment variable'' autopeasant.prompt;
assert lib.hasInfix "public repositories only" autopeasant.prompt;
assert lib.hasInfix "read, issues, pull-requests" autopeasant.prompt;
assert lib.hasInfix "Any operation not listed is not authorized." autopeasant.prompt;
assert lib.hasInfix "https://api.github.com" autopeasant.prompt;
assert lib.hasInfix "AUTONOMOUS-FILING POLICY" autopeasant.prompt;
assert lib.hasInfix ''Forge token "acme" (GitHub, github.com): the GH_ACME_TOKEN environment variable'' acmeGh.prompt;
assert lib.hasInfix "organization(s): acme" acmeGh.prompt;
assert lib.hasInfix "COMPANY POLICY" acmeGh.prompt;
assert lib.hasInfix ''Forge token "acme" (GitLab, gitlab.acme.example): the GITLAB_ACME_TOKEN environment variable'' acmeGl.prompt;
assert lib.hasInfix "exactly these repositories: acme/backend" acmeGl.prompt;
assert lib.hasInfix "https://gitlab.acme.example/api/v4" acmeGl.prompt;
assert lib.hasInfix "GITLAB_HOST=gitlab.acme.example" acmeGl.prompt;
assert lib.hasInfix "GITLAB POLICY" acmeGl.prompt;
# Shared confidentiality fragment binds every token.
assert lib.hasInfix "External-posting confidentiality" shared.prompt;
assert lib.hasInfix "private repository or organization names" shared.prompt;
# Suppression tags default to [ forge <forge> <account> ]; `when` rides along
# for the shared promptJson filter.
assert autopeasant.tags == [ "forge" "github" "autopeasant" ];
assert shared.tags == [ "forge" ];
assert autopeasant.when;
# Darwin consumes the same fragments and secret map.
assert (fragment darwin [ "forge" "github" "autopeasant" ]).prompt == autopeasant.prompt;
assert (fragment darwin [ "forge" ]).prompt == shared.prompt;
assert darwin.config.smind.hm.dev.llm.yolo.secretSessionVariables == secrets;
# Happy configurations pass every module assertion.
assert lib.all (a: a.assertion) linux.config.assertions;
assert lib.all (a: a.assertion) darwin.config.assertions;
assert lib.all (a: a.assertion) explicit.config.assertions;
# Fail-fast assertions fire on the expected invariant violations.
assert failedWith "at most one default = true entry per forge" twoDefaults;
assert failedWith "env var names must be unique" dupEnv;
assert failedWith "merge-requests is gitlab-only" wrongForgeOps;
assert failedWith "account must match" badAccount;
assert failedWith ''targets.repos entries must be "owner/name"'' badRepo;
assert failedWith "operations must not be empty" emptyOps;
assert failedWith "collides with validatedSessionVariables" collision;
pkgs.runCommandLocal "yolo-forge-tokens-eval-test" { } "touch $out"
