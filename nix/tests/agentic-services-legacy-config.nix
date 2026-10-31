# Synthetic legacy deployment binding used only for offline compatibility checks.
{ pkgs, ... }:
{
  smind.hm.services.agentic = {
    enable = true;
    unitPrefix = "ivm";
    stateDirectory = "/home/alice/.local/state/ivm-services";
    setupDependencies = [ "agenix.service" ];
    host = {
      hostname = "services.example.test";
      address = "100.64.0.2";
      scheme = "https";
      loopbackAlias = true;
    };
    tls = {
      certificateFile = "/var/lib/ivm-services-tls/cert.pem";
      keyFile = "/var/lib/ivm-services-tls/key.pem";
    };
    crawl4ai = {
      tokenFile = "/run/secrets/crawl4ai-api-token";
      package = pkgs.hello;
    };
    haystack = {
      package = pkgs.hello;
      agentTokenFile = "/run/secrets/ivm-haystack-agent-token";
      activityProjectId = "team-activity";
      legacyHosts = [ "legacy.services.example.test" ];
      legacyOrigins = [ "http://legacy.services.example.test:8085" ];
      insecureHttpOrigins = [ "http://legacy.services.example.test:8085" ];
    };
    manure = {
      package = pkgs.hello;
      agentTokenFile = "/run/secrets/ivm-manure-agent-token";
      legacyOrigins = [ "http://legacy.services.example.test:8086" ];
      allowInsecureHttp = true;
    };
    static = {
      publishTokenFile = "/run/secrets/ivm-static-publish-token";
      authRealm = "ivm publish";
      listingPath = "/.ivm-list/";
    };
  };
}
