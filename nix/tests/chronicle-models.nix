{ pkgs, nixpkgs }:
let
  lib = nixpkgs.lib;
  server = extra: (lib.nixosSystem {
    system = "x86_64-linux";
    modules = [ ../nixos/chronicle.nix { system.stateVersion = "26.11"; } extra ];
  }).config;
  stub = pkgs.writeShellScriptBin "vllm" "exit 1";
  files = {
    "config.json" = lib.concatStrings (lib.replicate 64 "a");
    "tokenizer_config.json" = lib.concatStrings (lib.replicate 64 "b");
    "tokenizer.json" = lib.concatStrings (lib.replicate 64 "c");
    "model.safetensors" = lib.concatStrings (lib.replicate 64 "d");
  };
  managed = {
    smind.services.chronicle = {
      enable = true;
      package = pkgs.writeShellScriptBin "chronicle-server" "exit 0";
      publicUrl = "https://chronicle.example.net";
      users.alice = { login = "alice"; passwordHashFile = "/run/secrets/alice-hash"; };
      database.passwordFile = "/run/secrets/database-key";
      embedding = { dimensions = 2048; queryPrefix = "query: "; documentPrefix = "passage: "; };
      models = lib.genAttrs [ "annotation" "embedding" ] (role: {
        enable = true;
        package = stub;
        repository = "example/${role}";
        revision = "113abe4acafa848e77ead9c0623205e511932348";
        inherit files;
        apiKeyFile = "/run/secrets/${role}-api-key";
        maxModelLength = 8192;
      });
    };
  };
  evaluated = server managed;
  disabled = server { };
  globallyDisabled = server { smind.services.chronicle.models.annotation.enable = true; };
  invalid = override: server (lib.recursiveUpdate managed override);
  failures = cfg: lib.filter (a: !a.assertion && lib.hasPrefix "Chronicle:" a.message) cfg.assertions;
  badRevision = invalid { smind.services.chronicle.models.annotation.revision = "main"; };
  badPaths = invalid { smind.services.chronicle.models.annotation.files."../secret" = lib.concatStrings (lib.replicate 64 "a"); };
  badCredential = invalid { smind.services.chronicle.models.embedding.apiKeyFile = pkgs.writeText "not-a-secret" ""; };
  badPorts = invalid { smind.services.chronicle.models.embedding.port = 47331; };
  badDevice = invalid { smind.services.chronicle.models.embedding.cudaVisibleDevices = [ ]; };
  external = invalid {
    smind.services.chronicle.annotation = {
      endpoint = "https://provider.example/v1/chat/completions";
      model = "external";
      revision = "external-v1";
      credentialFile = "/run/secrets/external-key";
    };
  };
  annotation = evaluated.systemd.services.chronicle-model-annotation;
  weights = evaluated.systemd.services.chronicle-model-annotation-weights;
  native = invalid { smind.services.chronicle.models.annotation.backend = "native"; };
  badImage = invalid { smind.services.chronicle.models.annotation.image = "vllm/vllm-openai:latest"; };
  dimensionsRequest = invalid { smind.services.chronicle.embedding.sendDimensions = true; };
  runtimeChange = invalid { smind.services.chronicle.models.embedding.image = "docker.io/vllm/vllm-openai@sha256:${lib.concatStrings (lib.replicate 64 "a")}"; };
  semanticChange = invalid { smind.services.chronicle.models.embedding.dtype = "float16"; };
  missingNativePackage = invalid { smind.services.chronicle.models.annotation = { backend = "native"; package = null; }; };
  badManagedRevision = invalid { smind.services.chronicle.embedding.revision = "stale-identity"; };
  codeChange = invalid { smind.services.chronicle.models.embedding.trustRemoteCode = true; };
  operationalChange = invalid { smind.services.chronicle.models.embedding = { port = 48000; cudaVisibleDevices = [ "3" ]; readinessTimeoutSeconds = 15; apiKeyFile = "/run/secrets/rotated-key"; hfTokenFile = "/run/secrets/hf-token"; }; };
in
assert failures evaluated == [ ];
assert failures badRevision != [ ];
assert failures badPaths != [ ];
assert failures badCredential != [ ];
assert failures badPorts != [ ];
assert failures badDevice != [ ];
assert !(disabled.systemd.services ? chronicle-model-annotation);
assert !(disabled.systemd.services ? chronicle-model-annotation-weights);
assert !(disabled.users.users ? chronicle-model-annotation);
assert !(globallyDisabled.systemd.services ? chronicle-model-annotation);
assert failures missingNativePackage != [ ];
assert lib.hasInfix "User=root" evaluated.systemd.units."chronicle-model-annotation.service".text;
assert lib.hasInfix "User=chronicle-model-annotation" evaluated.systemd.units."chronicle-model-annotation-weights.service".text;
assert lib.hasInfix "ExecStop=" evaluated.systemd.units."chronicle-model-annotation.service".text;
assert evaluated.smind.services.chronicle.annotation.endpoint == "http://127.0.0.1:47331/v1/chat/completions";
assert evaluated.smind.services.chronicle.embedding.endpoint == "http://127.0.0.1:47332/v1/embeddings";
assert evaluated.smind.services.chronicle.annotation.credentialFile == "/run/secrets/annotation-api-key";
assert external.smind.services.chronicle.annotation.endpoint == "https://provider.example/v1/chat/completions";
assert external.smind.services.chronicle.annotation.model == "external";
assert builtins.elem "chronicle-model-annotation.service" evaluated.systemd.services.chronicle.requires;
assert builtins.elem "chronicle-model-embedding.service" evaluated.systemd.services.chronicle.after;
assert builtins.elem "chronicle-model-annotation-weights.service" annotation.requires;
assert builtins.elem "chronicle.service" annotation.before;
assert annotation.serviceConfig.ExecStartPost != "";
assert annotation.serviceConfig.Restart == "on-failure";
assert annotation.serviceConfig.User == "root";
assert annotation.serviceConfig.RuntimeDirectoryMode == "0700";
assert weights.serviceConfig.User == "chronicle-model-annotation";
assert weights.serviceConfig.StateDirectoryMode == "0700";
assert weights.serviceConfig.CacheDirectory == "chronicle-model-annotation";
assert weights.serviceConfig.CacheDirectoryMode == "0700";
assert !(annotation.serviceConfig ? CacheDirectory);
assert !(annotation.serviceConfig ? CacheDirectoryMode);
assert !(lib.hasInfix "CacheDirectory=" evaluated.systemd.units."chronicle-model-annotation.service".text);
assert lib.hasInfix "CacheDirectory=chronicle-model-annotation" evaluated.systemd.units."chronicle-model-annotation-weights.service".text;
assert native.systemd.services.chronicle-model-annotation.serviceConfig.CacheDirectory == "chronicle-model-annotation";
assert native.systemd.services.chronicle-model-annotation.serviceConfig.CacheDirectoryMode == "0700";
assert native.systemd.services.chronicle-model-annotation.serviceConfig.User == "chronicle-model-annotation";
assert native.systemd.services.chronicle-model-annotation.serviceConfig.ReadOnlyPaths == [ "/var/lib/chronicle-model-annotation" ];
assert annotation.serviceConfig.LoadCredential == [ "api-key:/run/secrets/annotation-api-key" ];
assert weights.serviceConfig.LoadCredential == [ ];
assert weights.serviceConfig.Type == "oneshot";
assert builtins.elem "render" evaluated.users.users.chronicle-model-annotation.extraGroups;
assert annotation.environment.HF_HUB_OFFLINE == "1";
assert !(annotation.environment ? CUDA_VISIBLE_DEVICES);
assert native.systemd.services.chronicle-model-annotation.environment.CUDA_VISIBLE_DEVICES == "0";
assert evaluated.hardware.nvidia-container-toolkit.enable;
assert evaluated.virtualisation.podman.enable;
assert !disabled.hardware.nvidia-container-toolkit.enable;
assert !disabled.virtualisation.podman.enable;
assert builtins.elem "nvidia-container-toolkit-cdi-generator.service" annotation.requires;
assert builtins.elem "nvidia-container-toolkit-cdi-generator.service" annotation.after;
assert failures badImage != [ ];
assert failures badManagedRevision != [ ];
assert codeChange.smind.services.chronicle.embedding.revision != evaluated.smind.services.chronicle.embedding.revision;
assert semanticChange.smind.services.chronicle.embedding.revision != evaluated.smind.services.chronicle.embedding.revision;
assert dimensionsRequest.smind.services.chronicle.embedding.revision != evaluated.smind.services.chronicle.embedding.revision;
assert runtimeChange.smind.services.chronicle.embedding.revision != evaluated.smind.services.chronicle.embedding.revision;
assert operationalChange.smind.services.chronicle.embedding.revision == evaluated.smind.services.chronicle.embedding.revision;
assert !(builtins.elem 47331 evaluated.networking.firewall.allowedTCPPorts);
assert evaluated.smind.services.chronicle.models.annotation.image == "docker.io/vllm/vllm-openai@sha256:082ca6f035279109041ffd3fe0695cb568b29bc580b35c4f297a66a08b216c1b";
assert disabled.smind.services.chronicle.models.annotation.package == null;
pkgs.runCommandLocal "chronicle-models-test" { nativeBuildInputs = [ pkgs.python3 ]; } ''
  python ${./chronicle-model-runtime.py} ${../pkg/chronicle/model-runtime.py} ${lib.last (lib.splitString " " annotation.serviceConfig.ExecStart)} ${lib.last (lib.splitString " " evaluated.systemd.services.chronicle-model-embedding.serviceConfig.ExecStart)}
  touch "$out"
''
