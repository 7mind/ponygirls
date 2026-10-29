{ pkgs, nixpkgs, chronicleModule }:
let
  lib = nixpkgs.lib;
  source = (pkgs.callPackage ../pkg/chronicle/source.nix { }).development;
  hm = system: extra: (lib.evalModules {
    specialArgs.pkgs = import nixpkgs { inherit system; };
    modules = [
      ../hm/chronicle.nix
      ({ lib, ... }: {
        options.assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
        options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
        options.xdg.stateHome = lib.mkOption { type = lib.types.str; default = "/home/alice/.local/state"; };
        options.xdg.configFile = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.programs.mcp.servers = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.programs.codex.settings = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.smind.hm.dev.llm.yolo.validatedSessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
        options.systemd.user.services = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
      })
      extra
    ];
  }).config;
  configured = {
    smind.hm.dev.llm.chronicle = {
      enable = true;
      url = "https://chronicle.example.net/";
      tokenFile = "/run/secrets/chronicle-agent";
      collector.enable = true;
    };
    programs.mcp.servers.keep-me.command = "/bin/false";
  };
  linux = hm "x86_64-linux" configured;
  darwin = hm "aarch64-darwin" (lib.recursiveUpdate configured { smind.hm.dev.llm.chronicle.collector.enable = false; });
  admission = hm "x86_64-linux" (lib.recursiveUpdate configured { smind.hm.dev.llm.chronicle.collector = { excludeDefaultProfile = true; excludedYoloProfiles = [ "foo" "Foo" "foo" "default" ]; }; });
  invalidAdmission = value: hm "x86_64-linux" (lib.recursiveUpdate configured { smind.hm.dev.llm.chronicle.collector.excludedYoloProfiles = value; });
  invalidDefaultAdmission = hm "x86_64-linux" (lib.recursiveUpdate configured { smind.hm.dev.llm.chronicle.collector.excludeDefaultProfile = null; });
  separate = hm "x86_64-linux" (lib.recursiveUpdate configured { smind.hm.dev.llm.chronicle.collector.tokenFile = "/run/secrets/chronicle-ingest"; });
  collectorOnly = hm "x86_64-linux" { smind.hm.dev.llm.chronicle = { url = "https://chronicle.example.net"; collector = { enable = true; tokenFile = "/run/secrets/chronicle-ingest"; redactions.secretFiles = [ "/run/secrets/synthetic-other-credential" ]; }; }; };
  storeRedactionSecret = hm "x86_64-linux" (lib.recursiveUpdate configured { smind.hm.dev.llm.chronicle.collector.redactions.secretFiles = [ "/nix/store/synthetic-secret" ]; });
  missingCollectorToken = hm "x86_64-linux" { smind.hm.dev.llm.chronicle = { url = "https://chronicle.example.net"; collector.enable = true; }; };
  storeCollectorToken = hm "x86_64-linux" (lib.recursiveUpdate configured { smind.hm.dev.llm.chronicle.collector.tokenFile = "/nix/store/synthetic-token"; });
  storeAgentToken = hm "x86_64-linux" (lib.recursiveUpdate configured { smind.hm.dev.llm.chronicle.tokenFile = "/nix/store/synthetic-token"; });
  disabled = hm "x86_64-linux" { };
  missing = hm "x86_64-linux" { smind.hm.dev.llm.chronicle.enable = true; };
  darwinDaemon = hm "aarch64-darwin" configured;
  checked = cfg: lib.all (a: a.assertion) cfg.assertions;
  server = extra: (lib.nixosSystem {
    system = "x86_64-linux";
    modules = [ chronicleModule { system.stateVersion = "26.11"; } extra ];
  }).config;
  serverConfig = {
    smind.services.chronicle = {
      enable = true;
      package = pkgs.writeShellScriptBin "chronicle-server" "exit 0";
      publicUrl = "https://chronicle.example.net";
      users.alice = { login = "alice"; passwordHashFile = "/run/secrets/alice-password-hash"; };
      database.passwordFile = "/run/secrets/chronicle-database-password";
      annotation = { requestPolicy = "strict-json-schema"; endpoint = "http://127.0.0.1:8000/v1/chat/completions"; model = "annotation-model"; revision = "test-v1"; credentialFile = "/run/secrets/annotation-key"; };
      embedding = { endpoint = "http://127.0.0.1:8001/v1/embeddings"; model = "embedding-model"; revision = "test-v1"; credentialFile = "/run/secrets/embedding-key"; dimensions = 768; queryPrefix = "query: "; documentPrefix = "document: "; };
    };
  };
  staticToken = { id = "71d275ae-570d-4155-b4df-d84521f2043a"; userId = "alice"; name = "collector"; scopes = [ "Ingest" ]; tokenFile = "/run/secrets/synthetic-static-token"; };
  staticServer = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.staticTokens = [ staticToken ]; });
  invalidStaticOwner = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.staticTokens = [ (staticToken // { userId = "missing"; }) ]; });
  duplicateStaticId = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.staticTokens = [ staticToken staticToken ]; });
  invalidStaticScopes = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.staticTokens = [ (staticToken // { scopes = [ ]; }) ]; });
  maxBodyServer = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.limits.maxBodyBytes = 536870912; });
  oversizedBodyServer = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.limits.maxBodyBytes = 536870913; });
  enabledServer = server serverConfig;
  shortSessionServer = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.limits.sessionTtlSeconds = 3600; });
  defaultPackageServer = server { smind.services.chronicle = builtins.removeAttrs serverConfig.smind.services.chronicle [ "package" ]; };
  glmServer = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.annotation.requestPolicy = "glm-max-reasoning"; });
  capacityServer = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.indexing = { annotationSessions = 8; embeddingRequests = 12; embeddingBatchSize = 3; }; });
  invalidCapacity = field: value: server (lib.recursiveUpdate serverConfig { smind.services.chronicle.indexing.${field} = value; });
  rejectedCapacity = field: value: !(builtins.tryEval (builtins.getAttr field (invalidCapacity field value).smind.services.chronicle.indexing)).success;
  disabledServer = server { };
  sendDimensions = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.embedding.sendDimensions = true; });
  noSsd = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.database.ssdTuning = false; });
  customSsd = server (serverConfig // { services.postgresql.settings = { random_page_cost = 2.0; effective_io_concurrency = 64; maintenance_io_concurrency = 32; }; });
  externalDatabase = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.database = { manageLocal = false; jdbcUrl = "jdbc:postgresql://db.example/chronicle"; }; });
  insecureServer = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.publicUrl = "http://example.net"; });
  privateHttpServer = server (lib.recursiveUpdate serverConfig { smind.services.chronicle = { publicUrl = "http://192.168.50.10:47330"; allowInsecureHttp = true; }; });
  optedInHttpsServer = server (lib.recursiveUpdate serverConfig { smind.services.chronicle.allowInsecureHttp = true; });
  ownAssertions = cfg: lib.filter (a: !a.assertion && lib.hasPrefix "Chronicle:" a.message) cfg.assertions;
in
assert ownAssertions staticServer == [ ];
assert ownAssertions invalidStaticOwner != [ ];
assert ownAssertions duplicateStaticId != [ ];
assert ownAssertions invalidStaticScopes != [ ];
assert maxBodyServer.smind.services.chronicle.limits.maxBodyBytes == 536870912;
assert !(builtins.tryEval oversizedBodyServer.smind.services.chronicle.limits.maxBodyBytes).success;
assert builtins.elem "static-token-${builtins.hashString "sha256" staticToken.id}:/run/secrets/synthetic-static-token" staticServer.systemd.services.chronicle.serviceConfig.LoadCredential;
assert !(source.filter "${toString source.origSrc}/.local" "directory");
assert checked linux;
assert checked separate;
assert checked admission;
assert !linux.smind.hm.dev.llm.chronicle.collector.excludeDefaultProfile;
assert linux.smind.hm.dev.llm.chronicle.collector.excludedYoloProfiles == [ ];
assert admission.smind.hm.dev.llm.chronicle.collector.excludedYoloProfiles == [ "Foo" "default" "foo" ];
assert admission.smind.hm.dev.llm.chronicle.collector.discoverNative == linux.smind.hm.dev.llm.chronicle.collector.discoverNative;
assert admission.smind.hm.dev.llm.chronicle.collector.discoverYolo == linux.smind.hm.dev.llm.chronicle.collector.discoverYolo;
assert admission.smind.hm.dev.llm.chronicle.collector.exclusions == linux.smind.hm.dev.llm.chronicle.collector.exclusions;
assert !(builtins.tryEval invalidDefaultAdmission.smind.hm.dev.llm.chronicle.collector.excludeDefaultProfile).success;
assert lib.all (value: !(builtins.tryEval (builtins.deepSeq (invalidAdmission value).smind.hm.dev.llm.chronicle.collector.excludedYoloProfiles true)).success) [ null "Foo" [ 1 ] [ "." ] [ ".." ] [ "bad/name" ] [ "bad name" ] [ "Foo\n" ] ];
assert checked collectorOnly;
assert !(checked missingCollectorToken);
assert !(checked storeCollectorToken);
assert !(checked storeAgentToken);
assert !(checked storeRedactionSecret);
assert linux.smind.hm.dev.llm.chronicle.collector.tokenFile == linux.smind.hm.dev.llm.chronicle.tokenFile;
assert separate.smind.hm.dev.llm.yolo.validatedSessionVariables.CHRONICLE_TOKEN == "/run/secrets/chronicle-agent";
assert collectorOnly.programs.mcp.servers == { };
assert checked darwin;
assert !(checked missing);
assert !(checked darwinDaemon);
assert linux.programs.mcp.servers.chronicle.url == "https://chronicle.example.net/mcp";
assert linux.programs.mcp.servers.keep-me.command == "/bin/false";
assert linux.programs.mcp.servers.chronicle.headers.Authorization == "Bearer \${CHRONICLE_TOKEN}";
assert linux.programs.codex.settings.mcp_servers.chronicle.bearer_token_env_var == "CHRONICLE_TOKEN";
assert linux.smind.hm.dev.llm.yolo.validatedSessionVariables.CHRONICLE_TOKEN == "/run/secrets/chronicle-agent";
assert linux.systemd.user.services.chronicle-collector.Service.UMask == "0077";
assert toString linux.xdg.configFile."chronicle/collector.json".source == lib.last (lib.splitString " " linux.systemd.user.services.chronicle-collector.Service.ExecStart);
assert toString separate.xdg.configFile."chronicle/collector.json".source == lib.last (lib.splitString " " separate.systemd.user.services.chronicle-collector.Service.ExecStart);
assert toString collectorOnly.xdg.configFile."chronicle/collector.json".source == lib.last (lib.splitString " " collectorOnly.systemd.user.services.chronicle-collector.Service.ExecStart);
assert darwin.xdg.configFile == { };
assert disabled.xdg.configFile == { };
assert darwin.systemd.user.services == { };
assert disabled.programs.mcp.servers == { };
assert disabled.home.packages == [ ];
assert lib.all (a: a.assertion) (ownAssertions enabledServer);
assert !(lib.all (a: a.assertion) (ownAssertions insecureServer));
assert !enabledServer.smind.services.chronicle.allowInsecureHttp;
assert ownAssertions privateHttpServer == [ ];
assert ownAssertions optedInHttpsServer == [ ];
assert privateHttpServer.smind.services.chronicle.listenAddress == "127.0.0.1";
assert !(builtins.elem 47330 privateHttpServer.networking.firewall.allowedTCPPorts);
assert !(disabledServer.systemd.services ? chronicle);
assert defaultPackageServer.smind.services.chronicle.package.pname == "chronicle";
assert defaultPackageServer.smind.services.chronicle.package.toolchain.nativeImageFlags == [ "--static" "--libc=musl" ];
assert builtins.isString defaultPackageServer.smind.services.chronicle.package.offlineAssemblyCheck.drvPath;
assert enabledServer.systemd.services.chronicle.serviceConfig.User == "chronicle";
assert enabledServer.systemd.services.chronicle.serviceConfig.TimeoutStopSec == 60;
assert enabledServer.smind.services.chronicle.limits.sessionTtlSeconds == 30 * 24 * 60 * 60;
assert shortSessionServer.smind.services.chronicle.limits.sessionTtlSeconds == 3600;
assert enabledServer.smind.services.chronicle.indexing == { annotationSessions = 4; embeddingRequests = 8; embeddingBatchSize = 16; };
assert capacityServer.smind.services.chronicle.indexing == { annotationSessions = 8; embeddingRequests = 12; embeddingBatchSize = 3; };
assert rejectedCapacity "annotationSessions" 0;
assert rejectedCapacity "annotationSessions" 9;
assert rejectedCapacity "embeddingRequests" 0;
assert rejectedCapacity "embeddingRequests" 33;
assert rejectedCapacity "embeddingBatchSize" 0;
assert rejectedCapacity "embeddingBatchSize" 17;
assert builtins.elem "chronicle-database.service" enabledServer.systemd.services.chronicle.requires;
assert builtins.elem "postgresql-setup.service" enabledServer.systemd.services.chronicle-database.after;
assert builtins.elem "postgresql-setup.service" enabledServer.systemd.services.chronicle-database.requires;
assert !enabledServer.smind.services.chronicle.embedding.sendDimensions;
assert sendDimensions.smind.services.chronicle.embedding.sendDimensions;
assert enabledServer.services.postgresql.settings.random_page_cost == 1.1;
assert enabledServer.services.postgresql.settings.effective_io_concurrency == 200;
assert enabledServer.services.postgresql.settings.maintenance_io_concurrency == 100;
assert !(noSsd.services.postgresql.settings ? random_page_cost);
assert !(externalDatabase.services.postgresql.settings ? random_page_cost);
assert !(disabledServer.services.postgresql.settings ? random_page_cost);
assert customSsd.services.postgresql.settings.random_page_cost == 2.0;
assert customSsd.services.postgresql.settings.effective_io_concurrency == 64;
assert customSsd.services.postgresql.settings.maintenance_io_concurrency == 32;
assert !(enabledServer.services.postgresql.settings ? shared_buffers);
assert !(enabledServer.services.postgresql.settings ? fsync);
assert !(enabledServer.services.postgresql.settings ? synchronous_commit);
assert enabledServer.services.postgresql.enable;
assert enabledServer.services.postgresql.ensureDatabases == [ "chronicle" ];
assert !(builtins.elem 47330 enabledServer.networking.firewall.allowedTCPPorts);
assert enabledServer.services.nginx.virtualHosts."chronicle.example.net".locations."/".proxyWebsockets;
pkgs.runCommandLocal "chronicle-modules-test" { nativeBuildInputs = [ pkgs.jq ]; } ''
  test -n '${enabledServer.systemd.services.chronicle.serviceConfig.ExecStart}'
  jq -e '.annotation.requestPolicy == "strict-json-schema" and (.embedding | has("requestPolicy") | not)' ${lib.last (lib.splitString " " enabledServer.systemd.services.chronicle.serviceConfig.ExecStart)}
  jq -e '.annotation.requestPolicy == "glm-max-reasoning"' ${lib.last (lib.splitString " " glmServer.systemd.services.chronicle.serviceConfig.ExecStart)}
  jq -e '.sessionTtlSeconds == 2592000' ${lib.last (lib.splitString " " enabledServer.systemd.services.chronicle.serviceConfig.ExecStart)}
  jq -e '.sessionTtlSeconds == 3600' ${lib.last (lib.splitString " " shortSessionServer.systemd.services.chronicle.serviceConfig.ExecStart)}
  jq -e '.indexing == {annotationSessions:4,embeddingRequests:8,embeddingBatchSize:16}' ${lib.last (lib.splitString " " enabledServer.systemd.services.chronicle.serviceConfig.ExecStart)}
  jq -e '.indexing == {annotationSessions:8,embeddingRequests:12,embeddingBatchSize:3}' ${lib.last (lib.splitString " " capacityServer.systemd.services.chronicle.serviceConfig.ExecStart)}
  jq -e '.embedding.sendDimensions == false' ${lib.last (lib.splitString " " enabledServer.systemd.services.chronicle.serviceConfig.ExecStart)}
  jq -e '.embedding.sendDimensions == true' ${lib.last (lib.splitString " " sendDimensions.systemd.services.chronicle.serviceConfig.ExecStart)}
  jq -e '.allowInsecureHttp == false and .secureCookies == true' ${lib.last (lib.splitString " " enabledServer.systemd.services.chronicle.serviceConfig.ExecStart)}
  jq -e '.allowInsecureHttp == true and .secureCookies == false and .allowedOrigin == "http://192.168.50.10:47330"' ${lib.last (lib.splitString " " privateHttpServer.systemd.services.chronicle.serviceConfig.ExecStart)}
  jq -e '.allowInsecureHttp == true and .secureCookies == true' ${lib.last (lib.splitString " " optedInHttpsServer.systemd.services.chronicle.serviceConfig.ExecStart)}
  jq -e '.excludeDefaultProfile == false and .excludedYoloProfiles == []' ${lib.last (lib.splitString " " linux.systemd.user.services.chronicle-collector.Service.ExecStart)}
  jq -e '.excludeDefaultProfile == true and .excludedYoloProfiles == ["Foo","default","foo"] and .discoverNative == true and .discoverYolo == true' ${lib.last (lib.splitString " " admission.systemd.user.services.chronicle-collector.Service.ExecStart)}
  jq -e '.tokenFile == "/run/secrets/chronicle-agent"' ${lib.last (lib.splitString " " linux.systemd.user.services.chronicle-collector.Service.ExecStart)}
  jq -e '.tokenFile == "/run/secrets/chronicle-ingest"' ${lib.last (lib.splitString " " separate.systemd.user.services.chronicle-collector.Service.ExecStart)}
  jq -e '.tokenFile == "/run/secrets/chronicle-ingest" and .redactions.secretFiles == ["/run/secrets/synthetic-other-credential"]' ${lib.last (lib.splitString " " collectorOnly.systemd.user.services.chronicle-collector.Service.ExecStart)}
  jq -e '.staticTokens == [] and .maxBodyBytes == 8388608' ${lib.last (lib.splitString " " enabledServer.systemd.services.chronicle.serviceConfig.ExecStart)}
  jq -e '.staticTokens[0] == {id:"71d275ae-570d-4155-b4df-d84521f2043a",userId:"alice",name:"collector",scopes:["Ingest"],tokenFile:"/run/credentials/chronicle.service/static-token-${builtins.hashString "sha256" staticToken.id}"}' ${lib.last (lib.splitString " " staticServer.systemd.services.chronicle.serviceConfig.ExecStart)}
  touch "$out"
''
