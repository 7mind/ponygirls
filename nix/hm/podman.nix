{ config
, lib
, osConfig ? null
, pkgs
, ...
}:

let
  hostConfig = if osConfig == null then { } else osConfig;
  rootlessPodmanEnabled =
    pkgs.stdenv.hostPlatform.isLinux
    && (hostConfig.smind.containers.docker.enable or false)
    && (hostConfig.smind.containers.docker.rootless.enable or false);
  llmSocketPathValue = hostConfig.smind.containers.docker.rootless.llmSocketPath or null;
  llmSocketUriValue = hostConfig.smind.containers.docker.rootless.llmSocketUri or null;
  # Must match the NixOS-level wiring so we fail fast if the invariant breaks.
  llmSocketPath =
    if !rootlessPodmanEnabled then
      null
    else if llmSocketPathValue == null then
      throw "smind.containers.docker.rootless.llmSocketPath must be set when rootless Podman is enabled"
    else
      llmSocketPathValue;
  llmSocketUri =
    if !rootlessPodmanEnabled then
      null
    else if llmSocketUriValue == null then
      throw "smind.containers.docker.rootless.llmSocketUri must be set when rootless Podman is enabled"
    else
      llmSocketUriValue;
in
{
  options = {
    smind.hm.containers.docker.enable = lib.mkOption {
      type = lib.types.bool;
      default = rootlessPodmanEnabled;
      description = ''
        Wire this user's interactive shells to the host's restricted-user
        rootless Podman socket by exporting DOCKER_HOST / CONTAINER_HOST.
        Only applies when the NixOS host has rootless Podman enabled.

        Scoped to shell init (home.sessionVariables) on purpose: exporting
        these via NixOS's environment.sessionVariables would leak them into
        every systemd user manager's PAM environment, including podsvc-llm's,
        which causes its own `podman system service` to flip to remote-client
        mode and crash on start.
      '';
    };
  };

  config = lib.mkMerge [
    (lib.mkIf (rootlessPodmanEnabled && config.smind.hm.containers.docker.enable) {
      home.sessionVariables = {
        DOCKER_HOST = llmSocketUri;
        CONTAINER_HOST = llmSocketUri;
      };
    })
    (lib.mkIf (rootlessPodmanEnabled && config.smind.hm.dev.llm.enable) {
      smind.hm.dev.llm.podman = {
        socketPath = llmSocketPath;
        socketUri = llmSocketUri;
      };
    })
  ];
}
