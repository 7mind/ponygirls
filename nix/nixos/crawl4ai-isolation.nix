# Host-side bridge filter for a Crawl4AI container. Import this on the host
# that owns the veth, not inside the container.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.smind.services.crawl4ai.isolation;
  # nft -c opens a netlink socket, so it cannot run in a sandboxed build.
  rules = pkgs.runCommand "crawl4ai-isolation.nft" {
    preferLocalBuild = true;
  } ''
    substitute ${./../lib/crawl4ai-isolation.nft} "$out" \
      --replace-fail '@ifname@' ${lib.escapeShellArg cfg.interface}
    grep -q ${lib.escapeShellArg cfg.interface} "$out"
  '';
in
{
  options.smind.services.crawl4ai.isolation = {
    enable = lib.mkEnableOption ''
      host-side bridge filtering that stops the Crawl4AI container from
      opening new connections to local or non-global addresses, including
      the host
    '';

    interface = lib.mkOption {
      type = lib.types.str;
      default = "ve-crawl4ai";
      description = ''
        Host-side veth of the container (`ve-<container name>`). NixOS
        containers name this interface from the container name, truncated
        to 15 characters.
      '';
    };

    containerUnit = lib.mkOption {
      type = lib.types.str;
      default = "container@crawl4ai.service";
      description = ''
        systemd unit that starts the container. NixOS containers are
        instances of container@.service, not container-<name>.service.
        A drop-in orders that instance after the filter. Defining
        systemd.services for the instance replaces the template unit and
        drops ExecStart.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    boot.kernelModules = [ "nf_conntrack_bridge" ];

    # Drop-in only. requiredBy/before would synthesize a unit with this
    # name and, for container@crawl4ai.service, replace the template instance.
    environment.etc."systemd/system/${cfg.containerUnit}.d/isolation.conf".text = ''
      [Unit]
      After=crawl4ai-isolation.service
      Requires=crawl4ai-isolation.service
    '';

    systemd.services.crawl4ai-isolation = {
      description = "Crawl4AI container egress isolation";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        ExecStartPre = [
          "${pkgs.kmod}/bin/modprobe nf_conntrack_bridge"
          "-${pkgs.nftables}/bin/nft delete table bridge crawl4ai_isolation"
        ];
        ExecStart = "${pkgs.nftables}/bin/nft -f ${rules}";
        ExecStop = "${pkgs.nftables}/bin/nft delete table bridge crawl4ai_isolation";
      };
    };
  };
}
