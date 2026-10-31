{
  cfg,
  lib,
  pkgs,
}:
let
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
