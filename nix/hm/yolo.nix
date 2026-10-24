# Portable home-manager module for the `yolo` bubblewrap sandbox wrapper.
#
# Split out of dev-llm.nix (which had grown to own the whole Claude/Codex/Pi
# harness AND the sandbox) so the sandbox's options + package wiring live in one
# focused module. Imported alongside dev-llm via `homeManagerModules.dev-llm`,
# so it shares the same `config`: it reuses `smind.hm.dev.llm.enable` as its
# on/off switch. Provider/API-key secrets are wired here via
# `smind.hm.dev.llm.yolo.secretSessionVariables` (composed + sourced inside the
# sandbox), so every harness inherits them.
#
# Curried over the flake's `inputs` (for the codegraph package the per-project
# index bootstrap needs). All host/hardware coupling (device passthrough,
# rootless-Podman socket, ssh key, prompt extensions) is surfaced as
# `smind.hm.dev.llm.*` options the consumer wires from its own NixOS config —
# GPU passthrough is no longer built in, and plain read-only binds (e.g. an
# ollama models dir) go through extraReadOnlyPaths.
#
# Runtime tag gating (both wrappers): `--disable=<tag>` drops a default-on
# feature and `--enable=<tag>` turns on a default-off one, with --disable
# winning when a tag appears in both. The Linux wrapper's built-in features are
# audio (on by default) and display passthrough (tag "display", off by default —
# `yolo --enable=display` binds the Wayland compositor socket plus the
# X11/XWayland socket and auth file).
#
# Clipboard boundary (defects:D262, Linux): when a launch inherits a live host
# tmux session, the wrapper starts a per-launch host broker
# (yolo-clipboard-proxy) that grants the sandbox exactly two fixed operations
# — set the host clipboard (`tmux load-buffer -`) and read it back
# (`tmux save-buffer -`) — over a dedicated 0600 socket inside a 0700
# per-launch directory; a PATH-prepended `tmux` shim inside the sandbox
# forwards only load-buffer/save-buffer/show-buffer and rejects every other
# verb, so sandboxed processes hold bounded clipboard read/write authority but
# no host tmux command authority. Payloads are bounded to 1 MiB, the sandbox
# TMUX coordinate names only the broker socket, the inherited socket is masked
# out of every covering bind (alias-resistant raw-socket confinement), and
# every failure fails closed (clipboard disabled, never a raw host socket).
# Accepted fixed invocations can still trigger host-configured tmux hooks —
# after-load-buffer, after-save-buffer, and command-error — which belong to
# the host server's own configuration and receive no client-supplied argv.
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

  tuiTmux = pkgs.callPackage ../pkg/tui-tmux/default.nix { };
  cfg = config.smind.hm.dev.llm;

  # SSH key for remote worker machines: made available read-only (folded into
  # the read-only path set below) and announced via a prompt fragment —
  # replacing the old dedicated YOLO_LLM_SSH_KEY_PATH env + bind. null disables.
  sshKeySet = cfg.llmSshKeyPath != null;

  # Prompt extensions (Idea 1) as a JSON array of { target, tags, prompt },
  # Nix-`when`-filtered and in declaration order. yolo.sh composes each agent's
  # prompt at launch with jq and drops objects whose tags intersect the runtime
  # `--disable` set — so the same tag gates a device bind AND its note
  # (e.g. `--disable=gpu`). JSON carries multi-line prompt bodies verbatim.
  promptJson = builtins.toJSON (
    map (e: { inherit (e) target tags prompt; }) (lib.filter (e: e.when) cfg.yolo.promptExtensions)
  );

  # --- Forge tokens (GitHub / GitLab credentials with usage policy) ----------
  # One configured credential per (forge, account): injected as a secret
  # session variable under its resolved env-var name, and announced by its own
  # prompt fragment (account, instance, authorized targets/operations,
  # freeform policy, instance-appropriate CLI/API usage) plus one shared
  # confidentiality fragment when any token is configured. Policy-level only:
  # nothing at the sandbox or network layer restricts what a token is used for
  # once it is in the environment.
  forgeTokenOperations = [
    "read"
    "push"
    "issues"
    "pull-requests"
    "merge-requests"
    "comments"
    "discussions"
    "releases"
    "packages"
    "workflows"
    "wiki"
    "administration"
  ];
  forgeLabel = forge: if forge == "github" then "GitHub" else "GitLab";
  envComponent = account: lib.toUpper (builtins.replaceStrings [ "-" "." ] [ "_" "_" ] account);
  # The forge's canonical variable for `default = true`, else a derived
  # per-account name; an explicit `envVar` always wins.
  resolvedEnvVar = token:
    if token.envVar != null then
      token.envVar
    else if token.forge == "github" then
      (if token.default then "GH_TOKEN" else "GH_${envComponent token.account}_TOKEN")
    else
      (if token.default then "GITLAB_TOKEN" else "GITLAB_${envComponent token.account}_TOKEN");
  targetsText = instance: targets:
    let
      clauses =
        lib.optional targets.publicOnly "public repositories only (private and internal repositories are out of scope)"
        ++ lib.optional (targets.orgs != [ ]) "repositories owned by the organization(s): ${lib.concatStringsSep ", " targets.orgs}"
        ++ lib.optional (targets.repos != [ ]) "exactly these repositories: ${lib.concatStringsSep ", " targets.repos}";
    in
    if clauses == [ ] then "any repository on ${instance}" else lib.concatStringsSep ", and " clauses;
  usageText = token:
    let
      instance = token.instance;
    in
    if token.forge == "github" then
      if instance == "github.com" || lib.hasSuffix ".ghe.com" instance then
        "the `gh` CLI (it reads GH_TOKEN for these hosts — set GH_TOKEN to this token's value for the invocation when it is not named GH_TOKEN) or HTTPS calls to https://api.github.com with an `Authorization: Bearer` header"
      else
        "the `gh` CLI with GH_HOST=${instance} and GH_ENTERPRISE_TOKEN set to this token's value for the invocation, or HTTPS calls to https://${instance}/api/v3 with an `Authorization: Bearer` header"
    else if instance == "gitlab.com" then
      "the `glab` CLI (it reads GITLAB_TOKEN — set GITLAB_TOKEN to this token's value for the invocation when it is not named GITLAB_TOKEN) or HTTPS calls to https://gitlab.com/api/v4 with a `PRIVATE-TOKEN` header"
    else
      "the `glab` CLI with GITLAB_HOST=${instance} and GITLAB_TOKEN set to this token's value for the invocation, or HTTPS calls to https://${instance}/api/v4 with a `PRIVATE-TOKEN` header";
  forgeTokenPrompt = token: {
    target = "*";
    inherit (token) tags when;
    prompt = ''
      Forge token "${token.account}" (${forgeLabel token.forge}, ${token.instance}): the ${resolvedEnvVar token} environment variable carries a ${forgeLabel token.forge} token for the "${token.account}" account. Use it only as authorized below; when in doubt, do not use it and ask.

      Authorized targets: ${targetsText token.instance token.targets}.
      Authorized operations: ${lib.concatStringsSep ", " token.operations}. Any operation not listed is not authorized.
      API access: ${usageText token}.
    '' + lib.optionalString (token.policy != "") "\n${token.policy}\n";
  };
  forgeConfidentialityPrompt = {
    target = "*";
    tags = [ "forge" ];
    prompt = ''
      External-posting confidentiality (binds every forge token above): anything posted outside this machine — issues, pull or merge requests, comments, gists, packages, releases, commit messages — must not expose credentials, personal data, or any detail of a private project or host: no private repository or organization names, instance hostnames, internal paths, branch names, internal codenames, business or domain context, logs with private identifiers, or co-worker identity. Build self-contained reproductions that refer only to the dependency's public API and generic inputs; rewrite stack traces, file paths, and environment dumps so they contain nothing attributable. If a faithful report cannot be written without such leakage, do not post it — hand the user a sanitized draft instead. Never post an unverified hypothesis or a duplicate. Respect an explicit user instruction not to file.
    '';
  };
  forgeTokenType = lib.types.submodule (
    { config, ... }:
    {
      options = {
        account = lib.mkOption {
          type = lib.types.str;
          example = "autopeasant";
          description = ''
            Account label agents see in this token's prompt fragment. Must
            match `[A-Za-z0-9][A-Za-z0-9._-]*` — it also derives the
            environment-variable name and the default suppression tags.
          '';
        };
        forge = lib.mkOption {
          type = lib.types.enum [ "github" "gitlab" ];
          description = "Forge the token belongs to.";
        };
        tokenFile = lib.mkOption {
          type = lib.types.str;
          example = "/run/agenix/github-token-autopeasant";
          description = ''
            Host path of the secret FILE holding the single-line token (e.g. an
            agenix secret under `/run/agenix`). Transport is exactly
            {option}`smind.hm.dev.llm.yolo.secretSessionVariables`: composed
            into one 0600 file sourced inside the sandbox, never through argv.
          '';
        };
        default = lib.mkOption {
          type = lib.types.bool;
          default = false;
          description = ''
            Make this the forge's default credential: the environment variable
            becomes `GH_TOKEN` (github) or `GITLAB_TOKEN` (gitlab). At most one
            entry per forge may set this.
          '';
        };
        envVar = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          example = "GH_WORK_TOKEN";
          description = ''
            Explicit environment-variable name, overriding the derived one
            (`GH_<ACCOUNT>_TOKEN` / `GITLAB_<ACCOUNT>_TOKEN`, or the forge
            default when `default = true`).
          '';
        };
        instance = lib.mkOption {
          type = lib.types.str;
          default = if config.forge == "github" then "github.com" else "gitlab.com";
          defaultText = lib.literalExpression ''if forge == "github" then "github.com" else "gitlab.com"'';
          description = ''
            Forge instance the token is valid for: `github.com`, a `*.ghe.com`
            tenant, a GitHub Enterprise Server hostname, `gitlab.com`, or a
            self-managed GitLab hostname. The prompt fragment gives agents
            instance-appropriate API/CLI usage (`api/v3` vs `api/v4`,
            `GH_HOST`/`GH_ENTERPRISE_TOKEN` vs `GITLAB_HOST`/`GITLAB_TOKEN`).
          '';
        };
        targets = lib.mkOption {
          type = lib.types.submodule {
            options = {
              publicOnly = lib.mkOption {
                type = lib.types.bool;
                default = false;
                description = "Restrict to public repositories; private and internal repositories are out of scope.";
              };
              orgs = lib.mkOption {
                type = lib.types.listOf lib.types.str;
                default = [ ];
                example = [ "acme" ];
                description = "Restrict to repositories owned by these organizations (GitHub) or groups (GitLab).";
              };
              repos = lib.mkOption {
                type = lib.types.listOf lib.types.str;
                default = [ ];
                example = [ "acme/backend" ];
                description = ''Restrict to exactly these repositories, each `owner/name`.'';
              };
            };
          };
          default = { };
          description = ''
            Repository allowlist this token may act on. The constraints combine
            (intersection); an empty allowlist means any repository on
            `instance`.
          '';
        };
        operations = lib.mkOption {
          type = lib.types.listOf (lib.types.enum forgeTokenOperations);
          example = [ "read" "issues" "pull-requests" ];
          description = ''
            Operations the token is authorized for; anything not listed is
            stated as not authorized. `pull-requests` is GitHub-only and
            `merge-requests` GitLab-only.
          '';
        };
        policy = lib.mkOption {
          type = lib.types.lines;
          default = "";
          description = ''
            Free-form usage policy appended to this token's prompt fragment:
            what the account is for, when the token may and may not be used,
            and any autonomy rules (e.g. whether verified defects may be filed
            without asking).
          '';
        };
        tags = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ "forge" config.forge config.account ];
          defaultText = lib.literalExpression ''[ "forge" <forge> <account> ]'';
          description = ''
            Suppression tags for the token's prompt fragment (`yolo
            --disable=<tag>` drops the fragment; the token itself is still
            injected).
          '';
        };
        when = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = "Static (Nix-eval-time) gate: announce this token only when true (the token is still injected).";
        };
      };
    }
  );

  # Shared submodule for a tagged pre-start hook.
  hookType = lib.types.submodule {
    options = {
      command = lib.mkOption {
        type = lib.types.lines;
        description = "Shell command to run.";
      };
      targets = lib.mkOption {
        type = lib.types.listOf (lib.types.enum [ "claude" "codex" "pi" "shell" "cmd" "*" ]);
        default = [ "*" ];
        example = [ "claude" "codex" ];
        description = "Subcommands this hook applies to; '*' matches all subcommands in the hook's phase.";
      };
      tags = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        example = [ "codegraph" ];
        description = "Suppression tags; the hook is skipped if any is in the `--disable` set.";
      };
    };
  };

  # Pre-start hooks as JSON arrays of { command, tags, targets }. Host hooks
  # run before an agent session; sandbox hooks run INSIDE the sandbox (via the
  # entrypoint). Both filter by subcommand and drop tags in the `--disable` set.
  prehooksJson = builtins.toJSON cfg.yolo.hooks.pre-start.host;
  sandboxHooksJson = builtins.toJSON cfg.yolo.hooks.pre-start.sandbox;
  shellHooksJson = builtins.toJSON cfg.yolo.hooks.pre-start.shell;
  cmdHooksJson = builtins.toJSON cfg.yolo.hooks.pre-start.cmd;

  # codegraph passed into the sandbox via the package set (no dedicated binary
  # env anymore); the per-project index bootstrap is a sandbox pre-start hook
  # (contributed in config below). null disables these yolo contributions only.
  codegraphSet = cfg.yolo.codegraph != null;
  validPiSharedAsset = asset:
    let
      components = lib.splitString "/" asset;
    in
    asset != ""
    && lib.all (
      component:
      component != "."
      && component != ".."
      && builtins.match "^[A-Za-z0-9._-]+$" component != null
    ) components;

  managedConfigHome = if cfg.yolo.configureDefaultProfile then null
    else "${config.home.homeDirectory}/.config/yolo-managed-config";

  yoloPkg = pkgs.callPackage ../pkg/yolo/default.nix {
    inherit managedConfigHome;
    podmanSocketPath = cfg.podman.socketPath;
    podmanSocketUri = cfg.podman.socketUri;
    vmStateDirectory = if cfg.yolo.vm.enable then cfg.yolo.vm.stateDirectory else null;
    # The remote-worker SSH key is just another read-only bind.
    extraReadOnlyPaths = cfg.yolo.extraReadOnlyPaths ++ lib.optional sshKeySet cfg.llmSshKeyPath;
    extraReadWritePaths = cfg.yolo.extraReadWritePaths;
    # Device paths bound with device access (bwrap --dev-bind), e.g. GPU nodes.
    extraDevicePaths = cfg.yolo.extraDevicePaths;
    piSharedAssets = cfg.yolo.piSharedAssets;
    # Extra packages exposed ONLY inside the sandbox (not the host profile);
    # codegraph rides along here so its CLI / `init -i` work inside the sandbox.
    sandboxPackages =
      cfg.yolo.packages
      ++ [ tuiTmux ]
      ++ lib.optional codegraphSet cfg.yolo.codegraph
      ++ lib.optionals (cfg.yolo.vm.enable && isLinux) [
        pkgs.qemu_kvm
        pkgs.cloud-utils
        pkgs.systemd
      ];
    # Declarative env vars set inside the sandbox session.
    sessionVariables = cfg.yolo.sessionVariables;
    # Secret-file-backed env vars composed + sourced inside the sandbox.
    secretSessionVariables = cfg.yolo.secretSessionVariables;
    # Exact-byte-validated token files (fail-closed launches).
    validatedSessionVariables = cfg.yolo.validatedSessionVariables;
    # Tagged, runtime-suppressible system-prompt additions (see promptExtensions).
    inherit promptJson;
    # Tagged pre-start hooks: host (before sandbox) + sandbox (inside, via the
    # entrypoint). See hooks.pre-start.{host,sandbox}.
    inherit prehooksJson sandboxHooksJson shellHooksJson cmdHooksJson;
  };
in
{
  imports = [ ./yolo-managed-config.nix ];

  options = {
    smind.hm.dev.llm.yolo.configureDefaultProfile = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether to manage the native default Claude Code, Codex and Pi
        configuration files. When false, generated files are installed under
        {file}`~/.config/yolo-managed-config` instead, for named yolo profiles
        only. Bare harnesses and the default yolo profile retain their native,
        unmanaged configuration. This does not change harness configDir options
        or export configuration-directory environment variables.
      '';
    };

    # Host/hardware coupling surfaced as plain options; the consumer wires
    # them from its own NixOS config (device passthrough, rootless-Podman
    # socket). All default to off/null so a bare consumer works.
    smind.hm.dev.llm.podman.socketPath = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        Host path of a rootless-Podman socket to expose to sandboxed agents.
        Linux binds the socket; Darwin grants read access to its logical and
        canonical paths. On macOS with podman-mac-helper, use
        `~/.local/share/containers/podman/machine/podman.sock`. null disables it.
      '';
    };

    smind.hm.dev.llm.podman.socketUri = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        DOCKER_HOST-style URI for the rootless-Podman socket exposed via
        {option}`smind.hm.dev.llm.podman.socketPath`. null disables it.
      '';
    };

    smind.hm.dev.llm.llmSshKeyPath = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        Path to an SSH private key for remote worker machines. When set, the key
        is made available read-only inside the sandbox at the same host path,
        and a prompt fragment (tagged "ssh") tells agents how to authenticate.
        null disables both.
      '';
    };

    smind.hm.dev.llm.yolo.extraReadOnlyPaths = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = ''
        Extra host paths to expose read-only inside the yolo sandbox: Linux
        creates read-only bind mounts and Darwin appends exact Seatbelt grants.
        Paths that do not exist on the host are silently skipped. Use this for
        per-host bulk storage (e.g. `/srv/nvme`).
      '';
    };

    smind.hm.dev.llm.yolo.extraReadWritePaths = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = ''
        Extra host paths to expose read-write inside the yolo sandbox: Linux
        creates bind mounts and Darwin appends exact Seatbelt grants. Same
        skip-on-missing semantics as `extraReadOnlyPaths`.
      '';
    };

    smind.hm.dev.llm.yolo.extraDevicePaths = lib.mkOption {
      type = lib.types.listOf (lib.types.submodule {
        options = {
          path = lib.mkOption {
            type = lib.types.str;
            description = "Host device path to bind (file or directory).";
          };
          tags = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [ ];
            example = [ "gpu" "amd" ];
            description = ''
              Suppression tags (e.g. `[ "gpu" "amd" ]`). The runtime
              `yolo --disable=<tag>` flag drops every device (and prompt
              fragment) carrying that tag, so tag a device with both its broad
              feature ("gpu") and any finer label ("amd") you may want to target.
            '';
          };
        };
      });
      default = [ ];
      example = lib.literalExpression ''
        [
          { path = "/dev/dri"; tags = [ "gpu" ]; }
          { path = "/dev/kfd"; tags = [ "gpu" "amd" ]; }
        ]
      '';
      description = ''
        Linux host device paths bound into the sandbox WITH device access
        (bwrap `--dev-bind`) — e.g. GPU render nodes for compute passthrough.
        Darwin needs capability-specific Seatbelt rules instead. Each entry
        is `{ path; tags ? []; }`; a directory `path` exposes every device node
        under it (so `/dev/dri` covers all render nodes). A device is dropped at
        launch if any of its `tags` is in the `yolo --disable=<tag>` set (e.g.
        `--disable=gpu`). Missing paths are skipped. GPU passthrough is no longer
        built in: wire the device paths here, the non-device GPU bits
        (`/run/opengl-driver`, `/sys`) via
        {option}`smind.hm.dev.llm.yolo.extraReadOnlyPaths`, and the GPU
        availability note (tagged the same, so `--disable=gpu` hides it too) via
        {option}`smind.hm.dev.llm.yolo.promptExtensions`.
      '';
    };

    smind.hm.dev.llm.yolo.vm.enable = lib.mkEnableOption ''
      KVM-backed test virtual machines inside the yolo sandbox
    '';

    smind.hm.dev.llm.yolo.vm.stateDirectory = lib.mkOption {
      type = lib.types.str;
      default = "${config.xdg.stateHome}/yolo/vms";
      defaultText = lib.literalExpression ''"${config.xdg.stateHome}/yolo/vms"'';
      description = ''
        Persistent host directory exposed read-write to yolo for agent-managed
        VM disk images. Enabling the VM capability also exposes exactly
        `/dev/kvm` and adds QEMU, qemu-img, systemd-vmspawn, and cloud image
        utilities to the sandbox. It does not expose host block devices,
        `/dev/net/tun`, libvirt/Incus sockets, or a broad `/dev` tree.
      '';
    };

    smind.hm.dev.llm.yolo.piSharedAssets = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [
        "settings.json"
        "AGENTS.md"
        "APPEND_SYSTEM.md"
        "prompts"
        "skills"
        "extensions"
        "mcp.json"
      ];
      description = ''
        Paths relative to Pi's agent directory that named yolo profiles
        re-share read-only. Integrations may append their own projected asset
        directories.
      '';
    };

    smind.hm.dev.llm.yolo.promptExtensions = lib.mkOption {
      type = lib.types.listOf (lib.types.submodule {
        options = {
          prompt = lib.mkOption {
            type = lib.types.lines;
            description = "System-prompt fragment text appended to the targeted agent(s).";
          };
          target = lib.mkOption {
            type = lib.types.enum [ "claude" "pi" "*" ];
            default = "*";
            description = ''
              Which agent(s) the fragment is appended to: "claude", "pi", or
              "*" (both). Codex has no `--append-system-prompt` CLI hook, so it
              is not a valid target — deliver Codex instructions through the
              shared memory (`programs.codex` context / AGENTS.md) instead.
            '';
          };
          tags = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [ ];
            example = [ "gpu" ];
            description = ''
              Suppression tags. The fragment is dropped at launch if any tag is
              in the `yolo --disable=<tag>` set — the same namespace as
              {option}`smind.hm.dev.llm.yolo.extraDevicePaths` tags, so tagging
              the GPU note `[ "gpu" ]` makes `--disable=gpu` hide the note along
              with the GPU device binds.
            '';
          };
          when = lib.mkOption {
            type = lib.types.bool;
            default = true;
            description = ''
              Static (Nix-eval-time) gate: include this fragment only when true.
              Use it for per-host inclusion; use `tags` + `--disable` for
              per-run runtime suppression.
            '';
          };
        };
      });
      default = [ ];
      example = lib.literalExpression ''
        [
          { prompt = "GPU access is enabled (NVIDIA). /dev/dri is bound."; when = config.hardware.nvidia.modesetting.enable; }
          { prompt = "This host is the NAS; /srv holds the media library."; target = "*"; }
        ]
      '';
      description = ''
        Ordered system-prompt additions, appended (blank-line-separated) to each
        agent's `--append-system-prompt`, filtered per agent by `target`, gated
        statically by `when` (Nix-eval) and at runtime by `tags` + the
        `yolo --disable=<tag>` flag. List-merges across modules: this module
        contributes the YOLO pre-authorization note (target "claude"), the
        configured remote-worker SSH note (tag "ssh"), and the forge-token
        usage/confidentiality notes (tag "forge", see
        {option}`smind.hm.dev.llm.yolo.forgeTokens`). The consumer appends
        host-specific fragments (e.g. the GPU
        availability note, tagged "gpu"). Replaces the old hardcoded
        permission/GPU notes and the former `extraPromptFragments` option. Codex
        receives none (no CLI hook).
      '';
    };

    smind.hm.dev.llm.yolo.packages = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = [ ];
      example = lib.literalExpression "[ pkgs.ripgrep pkgs.jq pkgs.shellcheck ]";
      description = ''
        Extra packages to expose on `PATH` INSIDE the yolo sandbox without
        installing them into the host home profile. The packages are collected
        into a single `buildEnv` whose `bin` directory is prepended to the
        sandboxed command's `PATH` (the closure is already reachable through
        `/nix/store`, so no extra filesystem rule is needed). Applies to every
        `yolo` subcommand (claude/codex/pi/shell/cmd).
      '';
    };

    smind.hm.dev.llm.yolo.sessionVariables = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = lib.literalExpression ''
        {
          EDITOR = "nvim";
          RUST_BACKTRACE = "1";
        }
      '';
      description = ''
        Environment variables to set inside the sandbox session, as a NAME ->
        value map. Applied to every `yolo` subcommand and overridable by
        `--env NAME=VALUE`. Unlisted host variables are not inherited. Values
        may contain `=` but not newlines.
      '';
    };

    smind.hm.dev.llm.yolo.secretSessionVariables = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = lib.literalExpression ''
        {
          OPENROUTER_API_KEY   = "/run/agenix/openrouter";
          BRAVE_SEARCH_API_KEY = config.age.secrets.brave.path;
          ANTHROPIC_API_KEY    = config.age.secrets.anthropic.path;
        }
      '';
      description = ''
        Secret-file-backed environment variables for the sandbox, as a map from
        the environment-variable name to the host path of the secret FILE (e.g.
        an agenix secret under `/run/agenix`, or `config.age.secrets.<n>.path`).

        Unlike
        {option}`smind.hm.dev.llm.yolo.sessionVariables`, these never pass
        through the sandbox process's argv: yolo composes one mode-0600 file,
        sources it through the shared in-sandbox entrypoint before exec, and
        removes it on exit. Unreadable files are skipped with a warning. Values
        are single-line API tokens; use
        {option}`smind.hm.dev.llm.llmSshKeyPath` for multi-line key files.
      '';
    };

    smind.hm.dev.llm.yolo.validatedSessionVariables = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = lib.literalExpression ''
        { HAYSTACK_TOKEN = "/run/secrets/haystack-agent-token"; }
      '';
      description = ''
        Runtime token credentials for the sandbox, NAME -> fallback file path
        (empty path requires a runtime credential). Nonempty NAME and NAME_FILE
        conflict; otherwise either runtime source overrides the fallback file.
        Values must be canonical unpadded base64url for 32 bytes; files may have
        one final LF. Invalid or absent credentials fail the launch.

        Keys ending in _TOKEN normalize to a literal token in the private
        composed environment file. Keys ending in _TOKEN_FILE preserve file
        transport when no literal token is supplied, validating on the host
        and binding the selected absolute file path read-only. Literal mode
        never exports the companion file variable. Existing unrelated secrets
        keep their generic transport semantics.
      '';
    };

    smind.hm.dev.llm.yolo.forgeTokens = lib.mkOption {
      type = lib.types.listOf forgeTokenType;
      default = [ ];
      example = lib.literalExpression ''
        [
          {
            account = "autopeasant";
            forge = "github";
            tokenFile = "/run/agenix/github-token-autopeasant";
            default = true;
            targets.publicOnly = true;
            operations = [ "read" "issues" "pull-requests" ];
            policy = "An agent account for autonomous work, not the user's personal account. ...";
          }
          {
            account = "acme";
            forge = "gitlab";
            tokenFile = "/run/agenix/gitlab-token-acme";
            instance = "gitlab.acme.example";
            targets.orgs = [ "acme" ];
            operations = [ "read" "issues" "merge-requests" ];
          }
        ]
      '';
      description = ''
        GitHub/GitLab credentials with per-token usage policy. Each entry is
        injected as a secret session variable under its resolved env-var name
        (same transport as
        {option}`smind.hm.dev.llm.yolo.secretSessionVariables`) and announced by
        its own system-prompt fragment — account, instance, authorized targets
        and operations, free-form `policy`, instance-appropriate CLI/API usage —
        plus one shared confidentiality fragment when any token is configured.
        With several tokens per forge, each fragment tells agents which one to
        use for which target.

        Policy-level only: the tokens are ordinary environment variables once
        inside the sandbox — nothing at the sandbox or network layer prevents a
        determined process from using one outside its documented scope.
      '';
    };

    smind.hm.dev.llm.yolo.codegraph = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = codegraphPkg;
      defaultText = lib.literalExpression "pkgs.callPackage ../pkg/codegraph/package.nix { src = inputs.codegraph; }";
      description = ''
        The codegraph package, or null to remove yolo's codegraph package,
        bootstrap hook, and prompt contribution. When set, codegraph is added
        to the sandbox package set (its CLI / `init -i` work inside the sandbox),
        the per-project index bootstrap is registered as a `codegraph`-tagged
        sandbox pre-start hook for Claude and Codex, and a `codegraph`-tagged
        usage note is added to {option}`smind.hm.dev.llm.yolo.promptExtensions`.
        Pi instead prepares its index asynchronously through its extension,
        independently enabled by the codegraph MCP server in Pi's registry.
        `yolo --disable=codegraph` skips both the launcher bootstrap and Pi's
        automatic setup for that launch. The codegraph MCP server is configured
        separately (in tools.nix); neither it nor Pi's registry-driven extension
        integration is disabled by setting this option to null.
      '';
    };

    smind.hm.dev.llm.yolo.hooks.pre-start.host = lib.mkOption {
      type = lib.types.listOf hookType;
      default = [ ];
      description = ''
        Commands run ON THE HOST (in the launch directory) before the sandbox
        starts, for agent subcommands only (claude/codex/pi; shell/cmd skip
        them), each via `bash -c`. Run in declaration order, best-effort (a
        failure warns but does not abort). A hook is skipped if any of its
        `tags` is in the runtime `yolo --disable=<tag>` set or its `targets`
        excludes the selected subcommand. `targets` defaults to `[ "*" ]` and
        only filters within this phase; it does not enable host hooks for
        shell/cmd. List-merges across modules.
      '';
    };

    smind.hm.dev.llm.yolo.hooks.pre-start.sandbox = lib.mkOption {
      type = lib.types.listOf hookType;
      default = [ ];
      description = ''
        Commands run INSIDE the sandbox before the command, for agent
        subcommands only (claude/codex/pi). The surviving (non-`--disable`'d)
        hooks are composed into one script that the in-sandbox entrypoint
        SOURCES — after loading secret session variables and before exec'ing the
        agent — so a hook runs in that shell and any environment it exports is
        inherited by the agent (and it may use the secret env vars). Run in
        declaration order; a non-zero command does not abort (no `set -e`). A
        hook is skipped if any of its `tags` is in the `yolo --disable=<tag>` set
        or its `targets` excludes the selected subcommand. `targets` defaults
        to `[ "*" ]` and only filters within this phase.
        List-merges across modules: the per-project codegraph index bootstrap is
        contributed here for Claude/Codex (tag "codegraph") when
        {option}`smind.hm.dev.llm.yolo.codegraph` is non-null.
      '';
    };

    smind.hm.dev.llm.yolo.hooks.pre-start.shell = lib.mkOption {
      type = lib.types.listOf hookType;
      default = [ ];
      description = ''
        Commands run INSIDE the sandbox before the command, for the `shell`
        subcommand only. Execution, ordering, environment inheritance, failure,
        tag suppression, target filtering, and module merging follow
        {option}`smind.hm.dev.llm.yolo.hooks.pre-start.sandbox`.
      '';
    };

    smind.hm.dev.llm.yolo.hooks.pre-start.cmd = lib.mkOption {
      type = lib.types.listOf hookType;
      default = [ ];
      description = ''
        Commands run INSIDE the sandbox before the command, for the `cmd`
        subcommand only. Execution, ordering, environment inheritance, failure,
        tag suppression, target filtering, and module merging follow
        {option}`smind.hm.dev.llm.yolo.hooks.pre-start.sandbox`.
      '';
    };
  };

  config = lib.mkMerge [
    {
      assertions = [
        {
          assertion = lib.all validPiSharedAsset cfg.yolo.piSharedAssets;
          message = "smind.hm.dev.llm.yolo.piSharedAssets entries must be safe relative paths";
        }
        {
          assertion = lib.all (t: builtins.match "[A-Za-z0-9][A-Za-z0-9._-]*" t.account != null) cfg.yolo.forgeTokens;
          message = "smind.hm.dev.llm.yolo.forgeTokens: account must match [A-Za-z0-9][A-Za-z0-9._-]*";
        }
        {
          assertion = lib.all (t: builtins.match "[A-Za-z_][A-Za-z0-9_]*" (resolvedEnvVar t) != null) cfg.yolo.forgeTokens;
          message = "smind.hm.dev.llm.yolo.forgeTokens: resolved env var must match [A-Za-z_][A-Za-z0-9_]*";
        }
        {
          assertion = lib.length (lib.unique (map resolvedEnvVar cfg.yolo.forgeTokens)) == lib.length cfg.yolo.forgeTokens;
          message = "smind.hm.dev.llm.yolo.forgeTokens: env var names must be unique";
        }
        {
          assertion = lib.length (lib.unique (map (t: "${t.account}/${t.forge}") cfg.yolo.forgeTokens)) == lib.length cfg.yolo.forgeTokens;
          message = "smind.hm.dev.llm.yolo.forgeTokens: account/forge pairs must be unique";
        }
        {
          assertion = lib.all (forge: lib.length (lib.filter (t: t.forge == forge && t.default) cfg.yolo.forgeTokens) <= 1) [ "github" "gitlab" ];
          message = "smind.hm.dev.llm.yolo.forgeTokens: at most one default = true entry per forge";
        }
        {
          assertion =
            lib.all (t: t.forge == "github" || !(builtins.elem "pull-requests" t.operations)) cfg.yolo.forgeTokens
            && lib.all (t: t.forge == "gitlab" || !(builtins.elem "merge-requests" t.operations)) cfg.yolo.forgeTokens;
          message = "smind.hm.dev.llm.yolo.forgeTokens: pull-requests is github-only, merge-requests is gitlab-only";
        }
        {
          assertion = lib.all (t: t.operations != [ ]) cfg.yolo.forgeTokens;
          message = "smind.hm.dev.llm.yolo.forgeTokens: operations must not be empty";
        }
        {
          assertion = lib.all (t: t.instance != "") cfg.yolo.forgeTokens;
          message = "smind.hm.dev.llm.yolo.forgeTokens: instance must not be empty";
        }
        {
          assertion = lib.all (t: lib.all (r: builtins.match "[A-Za-z0-9._-]+/[A-Za-z0-9._-]+" r != null) t.targets.repos) cfg.yolo.forgeTokens;
          message = ''smind.hm.dev.llm.yolo.forgeTokens: targets.repos entries must be "owner/name"'';
        }
        {
          assertion = lib.intersectLists (map resolvedEnvVar cfg.yolo.forgeTokens) (lib.attrNames cfg.yolo.validatedSessionVariables) == [ ];
          message = "smind.hm.dev.llm.yolo.forgeTokens: env var collides with validatedSessionVariables";
        }
        {
          assertion = !cfg.yolo.vm.enable || isLinux;
          message = "smind.hm.dev.llm.yolo.vm.enable is supported only on Linux";
        }
        {
          assertion = !cfg.yolo.vm.enable || lib.hasPrefix "/" cfg.yolo.vm.stateDirectory;
          message = "smind.hm.dev.llm.yolo.vm.stateDirectory must be an absolute path";
        }
      ];

      # Forge tokens ride the generic secret transport under their resolved
      # env-var names (per-key merge with any plain secretSessionVariables).
      smind.hm.dev.llm.yolo.secretSessionVariables = lib.mkMerge (
        map (token: { "${resolvedEnvVar token}" = token.tokenFile; }) cfg.yolo.forgeTokens
      );

      # Module-provided prompt fragments, leading the list (mkBefore); the
      # consumer's fragments append after.
      #   - YOLO authorization (claude only — Pi/Codex have no permission system).
      #   - Sandbox-active note (every harness — yolo always sets SMIND_SANDBOXED,
      #     so presence of this fragment IS the "sandbox active" signal).
      #   - SSH remote-worker key usage (when llmSshKeyPath is set).
      #   - Per-token forge usage notes + shared confidentiality note (when
      #     forgeTokens is non-empty).
      smind.hm.dev.llm.yolo.promptExtensions = lib.mkBefore (
        [
          {
            target = "claude";
            prompt = ''YOLO mode is active. The user has pre-authorized destructive shell operations (rm, rm -rf, kill, git reset --hard, etc.) and will not be available to confirm. Proceed without asking for confirmation on such operations. Standard safety still applies to actions with broader blast radius (force-push to shared branches, deleting remote resources, sending external messages).'';
          }
          {
            target = "*";
            prompt =
              if isLinux then
                ''Sandbox: ACTIVE (bubblewrap via the 'yolo' wrapper; SMIND_SANDBOXED=1). Compilation, tests, git, and edits inside the project directory run directly, as do explicitly bound read-write paths. Before any tool call that reads, writes, installs, or runs anything else — $HOME, dotfiles, /etc, NixOS or home-manager, systemd, packages, host networking, another user's files, or any change that must outlive this process — read the environment skill and follow it. Do not improvise an exchange path. The exchange directory is the absolute path in $SMIND_EXCHANGE_DIR (read it with printenv); it is host tmpfs and does not survive a reboot. Do not write under /tmp/exchange itself.''
              else
                ''Sandbox: ACTIVE (macOS Seatbelt via the 'yolo' wrapper; SMIND_SANDBOXED=1). Network access remains available. Filesystem writes are confined to the project directory, agent configuration/profile directories, shared cache, temporary directories allowed by the base policy, and configured extra read-write paths; unrelated home-directory paths are denied.'';
          }
        ]
        ++ lib.optional sshKeySet {
          target = "*";
          tags = [ "ssh" ];
          prompt = ''A dedicated SSH private key for logging into remote worker machines is available read-only at ${cfg.llmSshKeyPath} inside the sandbox. When you are instructed to use remote worker machines, authenticate with this key — e.g. `ssh -i ${cfg.llmSshKeyPath} <user>@<host>` or `GIT_SSH_COMMAND='ssh -i ${cfg.llmSshKeyPath}' git <push|fetch> ...`.'';
        }
        ++ map forgeTokenPrompt cfg.yolo.forgeTokens
        ++ lib.optional (cfg.yolo.forgeTokens != [ ]) forgeConfidentialityPrompt
        ++ lib.optional codegraphSet {
          target = "*";
          tags = [ "codegraph" ];
          prompt = ''When the codegraph MCP is available, prefer `codegraph_explore` over grep/Read for symbol lookups and "where is X / what calls X / what breaks if I change X" questions: it returns verbatim line-numbered source plus callers and blast radius. Re-query with a refined question if the first answer is thin — a few explore calls still beat a grep/Read sweep. Zero hits means this tree isn't indexed for that language; fall back to `rg`/Read.'';
        }
      );
    }
    (lib.mkIf cfg.yolo.vm.enable {
      smind.hm.dev.llm.memorySections = lib.mkAfter [
        ''
          ## Local test virtual machines

          KVM-backed QEMU test VMs may be run inside yolo. Persistent VM images
          belong under `$YOLO_VM_STATE_DIR`; QEMU, qemu-img,
          systemd-vmspawn, and cloud-image utilities are available. Use QEMU
          user-mode networking unless a task explicitly requires a different
          topology. TUN/TAP devices and network namespaces created inside a
          guest use the guest kernel and need no host device passthrough.

          The sandbox exposes `/dev/kvm` but no host block devices,
          `/dev/net/tun`, libvirt socket, or Incus socket. Do not attach host
          filesystem directories, sockets, or device nodes to a guest. Guest
          disks must be regular image files under `$YOLO_VM_STATE_DIR` or the
          current project.
        ''
      ];
    })
    # CodeGraph per-project index bootstrap as a sandbox pre-start hook (tag
    # "codegraph"). Running inside confinement makes the selected index match
    # the paths visible to the agent's MCP server.
    # `--disable=codegraph` skips it; explicit tool paths keep it self-contained.
    (lib.mkIf codegraphSet {
      smind.hm.dev.llm.yolo.hooks.pre-start.sandbox = lib.mkBefore [
        {
          tags = [ "codegraph" ];
          targets = [ "claude" "codex" ];
          command = ''
            ${pkgs.bash}/bin/bash ${../pkg/yolo/codegraph-bootstrap.sh} \
              ${cfg.yolo.codegraph}/bin/codegraph ${pkgs.jq}/bin/jq ${pkgs.git}/bin/git
          '';
        }
      ];
    })
    # The sandbox is Linux-only (bubblewrap); on Darwin claude-code uses its own
    # sandbox wrapper, wired in dev-llm.nix. Gated on the shared harness enable.
    (lib.mkIf (cfg.enable && isLinux) {
      home.packages = [
        pkgs.bubblewrap
        yoloPkg
      ];
    })
    # Keep the callPackage inside mkIf so Linux evaluation never forces the
    # Darwin-only claude-code-sandbox package attribute.
    (lib.mkIf (cfg.enable && isDarwin) {
      home.packages = [
        (pkgs.callPackage ../pkg/yolo-darwin/default.nix {
          inherit managedConfigHome;
          claude-code-sandbox = inputs.claude-code-sandbox.packages.${system}.default;
          podmanSocketPath = cfg.podman.socketPath;
          podmanSocketUri = cfg.podman.socketUri;
          extraReadOnlyPaths = cfg.yolo.extraReadOnlyPaths ++ lib.optional sshKeySet cfg.llmSshKeyPath;
          extraReadWritePaths = cfg.yolo.extraReadWritePaths;
          piSharedAssets = cfg.yolo.piSharedAssets;
          sandboxPackages = cfg.yolo.packages ++ [ tuiTmux ] ++ lib.optional codegraphSet cfg.yolo.codegraph;
          sessionVariables = cfg.yolo.sessionVariables;
          secretSessionVariables = cfg.yolo.secretSessionVariables;
          validatedSessionVariables = cfg.yolo.validatedSessionVariables;
          inherit promptJson prehooksJson sandboxHooksJson shellHooksJson cmdHooksJson;
        })
      ];
    })
  ];
}
