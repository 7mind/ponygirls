{ config, lib, pkgs, ... }:
let
  cfg = config.smind.services.chronicle;
  roles = [ "annotation" "embedding" ];
  defaultImage = "docker.io/vllm/vllm-openai@sha256:082ca6f035279109041ffd3fe0695cb568b29bc580b35c4f297a66a08b216c1b";
  enabled = lib.filter (role: cfg.models.${role}.enable) roles;
  outsideStore = path: !(lib.hasPrefix builtins.storeDir (toString path));
  python = pkgs.python3.withPackages (p: [ p.huggingface-hub ]);
  helperScript = ../pkg/chronicle/model-runtime.py;
  helper = "${python}/bin/python ${helperScript}";
  modelOptions = role: {
    enable = lib.mkEnableOption "managed loopback vLLM ${role} endpoint and verified runtime weight download";
    backend = lib.mkOption { type = lib.types.enum [ "container" "native" ]; default = "container"; };
    package = lib.mkOption { type = lib.types.nullOr lib.types.package; default = null; description = "Required for native backend: explicitly supplied CUDA-compatible vLLM 0.29.0. The pinned nixpkgs CUDA vLLM is marked broken, so is not silently selected or unmarked."; };
    image = lib.mkOption { type = lib.types.str; default = defaultImage; description = "Digest-pinned official vllm/vllm-openai 0.29.0 linux/amd64 image. Runtime pull occurs outside the Nix store; never use a moving tag."; };
    repository = lib.mkOption { type = lib.types.str; description = "Hugging Face owner/repository, without URL or credentials."; };
    revision = lib.mkOption { type = lib.types.str; description = "Immutable, reviewed full 40-character model repository commit SHA; never a branch/tag."; };
    files = lib.mkOption { type = lib.types.attrsOf lib.types.str; description = "Complete serving file manifest: repository-relative path to lowercase SHA256. Include config, tokenizer, all weight shards/indexes and (only after review) required Python files. No unlisted files are downloaded; offline vLLM fails if the manifest is incomplete."; };
    servedModelName = lib.mkOption { type = lib.types.str; default = "chronicle-${role}"; };
    port = lib.mkOption { type = lib.types.port; default = if role == "annotation" then 47331 else 47332; };
    apiKeyFile = lib.mkOption { type = lib.types.path; description = "Runtime API key outside the store. Explicitly empty file permits unauthenticated loopback HTTP; loaded by both vLLM and Chronicle."; };
    hfTokenFile = lib.mkOption { type = lib.types.nullOr lib.types.path; default = null; description = "Optional runtime Hugging Face read token, loaded only by the download unit."; };
    cudaVisibleDevices = lib.mkOption { type = lib.types.listOf lib.types.str; default = [ (if role == "annotation" then "0" else "1") ]; description = "Explicit GPU indices or GPU UUIDs. NVIDIA driver provisioning is the host's responsibility. Separate defaults prevent accidental memory contention."; };
    tensorParallelSize = lib.mkOption { type = lib.types.ints.positive; default = 1; };
    dtype = lib.mkOption { type = lib.types.enum [ "auto" "bfloat16" "float16" "float32" ]; default = "bfloat16"; };
    enforceEager = lib.mkOption { type = lib.types.bool; default = false; description = "Disable CUDA graph capture when required by the model or memory budget."; };
    gpuMemoryUtilization = lib.mkOption { type = lib.types.float; default = 0.8; };
    maxModelLength = lib.mkOption { type = lib.types.ints.positive; description = "Explicit runtime context limit; size for the model and available device memory."; };
    trustRemoteCode = lib.mkOption { type = lib.types.bool; default = false; description = "Explicit opt-in to execute reviewed Python code from this pinned model's checksummed manifest. Never downloads code from a moving revision."; };
    readinessTimeoutSeconds = lib.mkOption { type = lib.types.ints.positive; default = 600; };
  };
  definitions = role:
    let
      model = cfg.models.${role};
      unit = "chronicle-model-${role}";
      root = "/var/lib/${unit}";
      weights = { inherit (model) repository revision files; };
      profileIdentity = {
        version = "chronicle-vllm-profile-v1";
        inherit weights;
        runtime = if model.backend == "container" then model.image else toString model.package;
        inherit (model) dtype enforceEager maxModelLength trustRemoteCode tensorParallelSize;
        runner = if role == "annotation" then "generate" else "pooling";
        defaultChatTemplateKwargs = lib.optionalAttrs (role == "annotation") { enable_thinking = false; };
        embeddingProfile = if role == "embedding" then { inherit (cfg.embedding) dimensions sendDimensions queryPrefix documentPrefix; } else null;
      };
      managedEndpoint = "http://127.0.0.1:${toString model.port}/v1/${if role == "annotation" then "chat/completions" else "embeddings"}";
      managedRevision = "${model.revision}:chronicle-vllm-profile-v1:${builtins.hashString "sha256" (builtins.toJSON profileIdentity)}";
      container = model.backend == "container";
      cache = "/var/cache/${unit}";
      runtime = "/run/${unit}";
      environment = {
        HF_HUB_OFFLINE = "1";
        TRANSFORMERS_OFFLINE = "1";
        HF_HUB_DISABLE_IMPLICIT_TOKEN = "1";
        HF_HUB_DISABLE_TELEMETRY = "1";
        VLLM_NO_USAGE_STATS = "1";
        DO_NOT_TRACK = "1";
        HOME = cache;
        HF_HOME = cache;
        XDG_CACHE_HOME = cache;
      } // lib.optionalAttrs (!container) { CUDA_VISIBLE_DEVICES = lib.concatStringsSep "," model.cudaVisibleDevices; };
      vllmConfig = pkgs.writeText "${unit}-vllm.yaml" (builtins.toJSON ({
        served-model-name = model.servedModelName;
        host = "127.0.0.1";
        inherit (model) port dtype;
        enforce-eager = model.enforceEager;
        runner = if role == "annotation" then "generate" else "pooling";
        tensor-parallel-size = model.tensorParallelSize;
        gpu-memory-utilization = model.gpuMemoryUtilization;
        max-model-len = model.maxModelLength;
        trust-remote-code = model.trustRemoteCode;
      } // lib.optionalAttrs (role == "annotation") { default-chat-template-kwargs = { enable_thinking = false; }; }));
      runtimeConfig = pkgs.writeText "${unit}-runtime.json" (builtins.toJSON {
        inherit root weights vllmConfig unit cache runtime environment;
        helper = "${helperScript}";
        executable = if container then "vllm" else "${model.package}/bin/vllm";
        image = if container then model.image else null;
        devices = model.cudaVisibleDevices;
        podman = "${pkgs.podman}/bin/podman";
        hfToken = model.hfTokenFile != null;
        url = "http://127.0.0.1:${toString model.port}";
        model = model.servedModelName;
        readyTimeout = model.readinessTimeoutSeconds;
      });
      common = {
        User = unit;
        Group = unit;
        StateDirectory = unit;
        StateDirectoryMode = "0700";
        UMask = "0077";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        RestrictSUIDSGID = true;
        CapabilityBoundingSet = "";
      };
    in {
      assertions = [
        { assertion = cfg.${role}.endpoint != managedEndpoint || (cfg.${role}.revision == managedRevision && cfg.${role}.model == model.servedModelName); message = "Chronicle: a managed model endpoint must use its generated semantic revision and served model name; an external endpoint may retain its explicit identity."; }
        { assertion = !container || pkgs.stdenv.hostPlatform.system == "x86_64-linux"; message = "Chronicle: managed official OCI runtime is supported only on x86_64-linux; supply a native CUDA package elsewhere."; }
        { assertion = container || model.package != null; message = "Chronicle: native model backend requires an explicitly supplied CUDA-compatible vLLM package."; }
        { assertion = !container || builtins.match "(docker[.]io/)?vllm/vllm-openai@sha256:[0-9a-f]{64}" model.image != null; message = "Chronicle: managed containers require the official vLLM image pinned by registry digest."; }
        { assertion = !container || (config.hardware.nvidia-container-toolkit.device-name-strategy == "index" && lib.all (device: builtins.match "[0-9]+" device != null) model.cudaVisibleDevices) || (config.hardware.nvidia-container-toolkit.device-name-strategy == "uuid" && lib.all (device: lib.hasPrefix "GPU-" device) model.cudaVisibleDevices); message = "Chronicle: GPU IDs must match the host NVIDIA CDI device-name-strategy (index or uuid)."; }
        { assertion = builtins.match "[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+" model.repository != null; message = "Chronicle: managed ${role} requires an owner/repository identity, not a URL."; }
        { assertion = builtins.match "[0-9a-f]{40}" model.revision != null; message = "Chronicle: managed ${role} requires a full pinned model commit SHA."; }
        { assertion = model.files ? "config.json" && model.files ? "tokenizer_config.json" && lib.any (file: builtins.hasAttr file model.files) [ "tokenizer.json" "tokenizer.model" "spiece.model" "vocab.json" ] && lib.any (name: lib.hasSuffix ".safetensors" name || lib.hasSuffix ".bin" name) (builtins.attrNames model.files) && lib.all (name: builtins.match "[a-zA-Z0-9_.-]+(/[a-zA-Z0-9_.-]+)*" name != null && lib.all (p: p != "." && p != "..") (lib.splitString "/" name) && name != ".complete.json") (builtins.attrNames model.files) && lib.all (sha: builtins.match "[0-9a-f]{64}" sha != null) (builtins.attrValues model.files); message = "Chronicle: managed ${role} requires a complete relative-path SHA256 manifest including model/tokenizer config, tokenizer data and weights."; }
        { assertion = outsideStore model.apiKeyFile && (model.hfTokenFile == null || outsideStore model.hfTokenFile); message = "Chronicle: managed model credentials must be runtime paths outside the Nix store."; }
        { assertion = model.gpuMemoryUtilization > 0 && model.gpuMemoryUtilization < 1; message = "Chronicle: gpuMemoryUtilization must be strictly between zero and one."; }
        { assertion = model.cudaVisibleDevices != [ ] && lib.all (device: builtins.match "([0-9]+|GPU-[a-zA-Z0-9-]+)" device != null) model.cudaVisibleDevices && builtins.length model.cudaVisibleDevices == builtins.length (lib.unique model.cudaVisibleDevices) && model.tensorParallelSize <= builtins.length model.cudaVisibleDevices; message = "Chronicle: specify distinct CUDA devices with at least tensorParallelSize entries."; }
        { assertion = model.servedModelName != "" && !(lib.hasInfix "\n" model.servedModelName); message = "Chronicle: managed model name must be nonempty and single-line."; }
      ];
      hardware.nvidia-container-toolkit.enable = lib.mkIf container true;
      virtualisation.podman.enable = lib.mkIf container true;
      users.groups.${unit} = { };
      users.users.${unit} = { isSystemUser = true; group = unit; extraGroups = [ "video" "render" ]; };
      smind.services.chronicle.${role} = {
        endpoint = lib.mkDefault managedEndpoint;
        model = lib.mkDefault model.servedModelName;
        revision = lib.mkDefault managedRevision;
        credentialFile = lib.mkDefault model.apiKeyFile;
      };
      systemd.services.${unit + "-weights"} = {
        description = "Verified pinned Chronicle ${role} model weights (resumable download)";
        wants = [ "network-online.target" ];
        after = [ "network-online.target" ];
        before = [ "${unit}.service" ];
        environment = { HF_HUB_DISABLE_IMPLICIT_TOKEN = "1"; HF_HUB_DISABLE_TELEMETRY = "1"; HF_HOME = "${root}/download-cache"; };
        restartTriggers = [ runtimeConfig ];
        serviceConfig = common // {
          Type = "oneshot";
          ExecStart = "${helper} fetch ${runtimeConfig}";
          CacheDirectory = lib.mkIf container unit;
          CacheDirectoryMode = lib.mkIf container "0700";
          LoadCredential = lib.optional (model.hfTokenFile != null) "hf-token:${model.hfTokenFile}";
          TimeoutStartSec = "infinity";
          RemainAfterExit = true;
        };
      };
      systemd.services.${unit} = {
        description = "Chronicle ${role} loopback vLLM";
        requires = [ "${unit}-weights.service" ] ++ lib.optional container "nvidia-container-toolkit-cdi-generator.service";
        after = [ "${unit}-weights.service" ] ++ lib.optional container "nvidia-container-toolkit-cdi-generator.service";
        before = [ "chronicle.service" ];
        inherit environment;
        restartTriggers = [ runtimeConfig vllmConfig ];
        serviceConfig = (if container then {
          User = "root";
          Group = "root";
          RuntimeDirectory = unit;
          RuntimeDirectoryMode = "0700";
          UMask = "0077";
        } else common // { ReadOnlyPaths = [ root ]; }) // {
          ExecStart = "${helper} ${if container then "container" else "serve"} ${runtimeConfig}";
          ExecStartPost = "${helper} ready ${runtimeConfig}";
          ExecStop = lib.mkIf container "${pkgs.podman}/bin/podman stop --ignore ${unit}";
          ExecStopPost = lib.mkIf container "${pkgs.podman}/bin/podman rm --force --ignore ${unit}";
          LoadCredential = [ "api-key:${model.apiKeyFile}" ];
          CacheDirectory = lib.mkIf (!container) unit;
          CacheDirectoryMode = lib.mkIf (!container) "0700";
          Restart = "on-failure";
          RestartSec = 10;
          TimeoutStartSec = model.readinessTimeoutSeconds + 30;
          TimeoutStopSec = 60;
        };
      };
    };
in {
  options.smind.services.chronicle.models = lib.genAttrs roles (role: lib.mkOption {
    type = lib.types.submodule { options = modelOptions role; };
    default = { };
    description = "Optional managed ${role} model; disabled has no weights, runtime or GPU side effects. Embedding dimensions/prefixes remain explicit on the Chronicle embedding profile.";
  });
  config = lib.mkIf cfg.enable (lib.mkMerge ([ {
    assertions = [
      { assertion = !(cfg.models.annotation.enable && cfg.models.embedding.enable) || cfg.models.annotation.port != cfg.models.embedding.port; message = "Chronicle: managed annotation and embedding require separate loopback ports."; }
      { assertion = lib.all (role: cfg.models.${role}.port != cfg.port) enabled; message = "Chronicle: model ports must differ from the Chronicle backend port."; }
    ];
    systemd.services.chronicle = lib.mkIf (enabled != [ ]) {
      requires = map (role: "chronicle-model-${role}.service") enabled;
      after = map (role: "chronicle-model-${role}.service") enabled;
    };
  } ] ++ map (role: lib.mkIf cfg.models.${role}.enable (definitions role)) roles));
}
