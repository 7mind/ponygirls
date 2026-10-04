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
        systemd unit that starts the container. NixOS declarative
        containers are container@<name>.service. This unit is ordered
        after the filter with Before= and requiredBy, which adds a
        .requires symlink. Do not define systemd.services for that
        name here: a partial definition is a unit with no ExecStart.
        Do not install a drop-in through environment.etc either:
        /etc/systemd/system is a symlink, and mkdir of a subdirectory
        follows it into the read-only unit package.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    boot.kernelModules = [ "nf_conntrack_bridge" ];

    systemd.services.crawl4ai-isolation = {
      description = "Crawl4AI container egress isolation";
      wantedBy = [ "multi-user.target" ];
      before = [ cfg.containerUnit ];
      requiredBy = [ cfg.containerUnit ];
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
