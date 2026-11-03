# Actual exported NixOS module -> exact declaration consumed by the browser
# harness. Ports are declared, never rewritten after evaluation. No activation.
{ pkgs, nixpkgs, haystackModule, haystackPackage, backendPort ? 47328, publicPort ? 58445 }:
let
  cfg=(nixpkgs.lib.nixosSystem {
    system=pkgs.stdenv.hostPlatform.system;
    modules=[haystackModule {
      system.stateVersion="26.11";
      smind.services.haystack={enable=true;package=haystackPackage;port=backendPort;publicUrl="https://127.0.0.1:${toString publicPort}";
        database={jdbcUrl="jdbc:postgresql://127.0.0.1:1/proxy-declaration-only";user="haystack";passwordFile="/run/test/haystack-database";readinessUnit=null;};
        users.op={type="human";tokens.browser.tokenHashFile="/run/test/haystack-token-sha256";};
      };
    }];
  }).config;
  host=cfg.services.nginx.virtualHosts."127.0.0.1";
in pkgs.writeText "haystack-actual-nixos-proxy-fixture.json" (builtins.toJSON {
  inherit backendPort;
  publicUrl=cfg.smind.services.haystack.publicUrl;
  inherit (host) root;
  locations=builtins.mapAttrs (_: location: {inherit (location) proxyPass proxyWebsockets tryFiles extraConfig;}) host.locations;
})
