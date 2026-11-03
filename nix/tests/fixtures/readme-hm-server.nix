  { config, inputs, ... }:
  let
    database = name:
      let connection = config.ponygirls.servicePostgres.connections.${name};
      in {
        inherit (connection) jdbcUrl readinessUnit;
        user = connection.databaseUser;
        passwordFile = connection.databasePasswordFile;
        limits.maxConnections = connection.maxConnections;
      };
  in {
    imports = [ inputs.ponygirls.homeManagerModules.agenticServicesServer ];
    ponygirls.servicePostgres = {
      enable = true;
      stateDirectory = "/home/alice/.local/state/ponygirls-postgres-18";
      databases = {
        haystack = { name = "haystack"; user = "haystack"; passwordFile = "/run/user/1000/secrets/haystack-db"; };
        manure = { name = "manure"; user = "manure"; passwordFile = "/run/user/1000/secrets/manure-db"; schemas = [ "public" "manure" ]; };
      };
    };
    smind.hm.services.agentic = {
      enable = true;
      stateDirectory = "/home/alice/.local/state/agentic-services";
      host = { hostname = "services.example.net"; address = "127.0.0.1"; };
      tls = { certificateFile = "/run/user/1000/services/cert.pem"; keyFile = "/run/user/1000/services/key.pem"; };
      crawl4ai.tokenFile = "/run/user/1000/secrets/crawl4ai";
      haystack = { agentTokenFile = "/run/user/1000/secrets/haystack"; database = database "haystack"; };
      manure = { agentTokenFile = "/run/user/1000/secrets/manure"; database = database "manure"; };
    };
  }
