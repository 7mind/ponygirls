{ config, inputs, ... }:
let database = config.ponygirls.servicePostgres.connections.chronicle;
in {
imports = [ inputs.ponygirls.nixosModules.chronicle ];
ponygirls.servicePostgres = {
  enable = true;
  stateDirectory = "/var/lib/ponygirls-postgres-18";
  databases.chronicle = {
    name = "chronicle";
    user = "chronicle";
    passwordFile = "/run/secrets/chronicle-db-password";
    lockTimeoutMs = 35000;
    idleTransactionTimeoutMs = 60000;
  };
};
smind.services.chronicle = {
  enable = true;
  publicUrl = "https://chronicle.example.net";
  users.alice = {
    login = "alice";
    passwordHashFile = "/run/secrets/chronicle-alice-password-hash";
  };
  database = {
    inherit (database) jdbcUrl readinessUnit;
    user = database.databaseUser;
    passwordFile = database.databasePasswordFile;
    limits.maxConnections = database.maxConnections;
  };
  annotation = {
    requestPolicy = "strict-json-schema";
    endpoint = "http://127.0.0.1:8000/v1/chat/completions";
    model = "archive-annotator";
    revision = "your-immutable-deployment-revision";
    credentialFile = "/run/secrets/chronicle-annotation-key";
  };
  embedding = {
    endpoint = "http://127.0.0.1:8001/v1/embeddings";
    model = "nvidia/llama-nemotron-embed-1b-v2";
    revision = "your-immutable-checkpoint-revision";
    dimensions = 2048;
    sendDimensions = false;
    queryPrefix = "query: ";
    documentPrefix = "passage: ";
    credentialFile = "/run/secrets/chronicle-embedding-key";
  };
  proxy.acmeHost = "chronicle.example.net"; # or terminate TLS at your existing edge
};
}
