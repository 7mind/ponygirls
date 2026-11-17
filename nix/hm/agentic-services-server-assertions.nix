{
  cfg,
  lib,
  pkgs,
  serviceUsers,
  accountsKeyFile,
}:
let
  accounts = import ../lib/service-account-options.nix { inherit lib; };
  runtimePath =
    path:
    path != null
    && lib.hasPrefix "/" path
    && path != builtins.storeDir
    && !(lib.hasPrefix "${builtins.storeDir}/" path)
    && builtins.match "/[A-Za-z0-9_./-]+" path != null;
  assertThat = assertion: message: {
    inherit assertion;
    message = "smind.hm.services.agentic: ${message}";
  };
in
[
  (assertThat (!cfg.manure.enable || cfg.manure.rootBindingMode == "strict" || cfg.manure.migrationReceiptDirectory == null) "Manure migrationReceiptDirectory requires strict rootBindingMode.")
  (assertThat (!cfg.manure.enable || (runtimePath cfg.manure.dataDirectory && (cfg.manure.migrationReceiptDirectory == null || runtimePath cfg.manure.migrationReceiptDirectory))) "Manure payload/control roots must be explicit absolute runtime paths, independent of existing credentials.")
  (assertThat (!cfg.manure.enable || runtimePath cfg.manure.database.passwordFile) "Manure database credentials must be runtime file references.")
  (assertThat (!cfg.haystack.enable || runtimePath cfg.haystack.database.passwordFile) "Haystack database credentials must be runtime file references.")
  (assertThat pkgs.stdenv.hostPlatform.isLinux "user servers require Linux.")
  (assertThat (runtimePath cfg.stateDirectory) "stateDirectory must be an absolute runtime path outside the Nix store, without whitespace or config metacharacters.")
  (assertThat (runtimePath cfg.crawl4ai.tokenFile) "crawl4ai.tokenFile must be an absolute runtime path outside the Nix store.")
  (assertThat (
    cfg.host.scheme != "https" || (runtimePath cfg.tls.certificateFile && runtimePath cfg.tls.keyFile)
  ) "HTTPS requires absolute runtime tls.certificateFile and tls.keyFile paths.")
  (assertThat (
    !cfg.static.enable || runtimePath cfg.static.root
  ) "static.root must be an absolute runtime path outside the Nix store.")
  (assertThat (
    !cfg.static.enable || cfg.static.publishTokenFile == null || runtimePath cfg.static.publishTokenFile
  ) "static.publishTokenFile must be an absolute runtime path outside the Nix store.")
  (assertThat (
    !cfg.haystack.enable || runtimePath cfg.haystack.agentTokenFile
  ) "haystack.agentTokenFile must be an absolute runtime path outside the Nix store.")
  (assertThat (
    !cfg.manure.enable || runtimePath cfg.manure.agentTokenFile
  ) "manure.agentTokenFile must be an absolute runtime path outside the Nix store.")
]
++
  map
    (
      name:
      assertThat (
        cfg.${name}.listenAddress == "127.0.0.1"
      ) "${name}.listenAddress must remain 127.0.0.1; expose only the reverse proxy."
    )
    [
      "crawl4ai"
      "searxng"
      "haystack"
      "manure"
    ]
++ lib.concatMap (name:
  if !cfg.${name}.enable then [ ] else
  accounts.assertions "smind.hm.services.agentic.${name}" serviceUsers.${name} ++ [
    (assertThat (!(cfg.${name}.users ? agent) && !(cfg.${name}.users ? operator)) "${name}.users must not replace the reserved agent/operator identities; use ${name}.operator for explicit operator browser credentials.")
    (assertThat (lib.all (user: lib.all (token: runtimePath token.tokenHashFile) (builtins.attrValues user.tokens)) (builtins.attrValues serviceUsers.${name})) "${name} configured token digests must be absolute runtime file references outside the Nix store.")
  ] ++ accounts.accountsAssertions {
    context = "smind.hm.services.agentic.${name}";
    settings = cfg.${name}.accounts;
    users = serviceUsers.${name};
    keyFile = accountsKeyFile name;
    origin = cfg.urls.${name};
  }) [ "haystack" "manure" ]
