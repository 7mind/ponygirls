{ lib, callPackage, symlinkJoin, squishLib, pi-coding-agent }:
let
  server = callPackage ./server.nix { inherit squishLib; };
  web = callPackage ./web.nix { };
  worker = callPackage ./worker.nix { inherit pi-coding-agent; };
in symlinkJoin {
  name = "ontology-0.1.0";
  paths = [ server web worker ];
  passthru = {
    inherit web worker;
    serverArtifact = server;
    inherit (server) runtimeSource sharedJavaRuntime;
  };
  meta = {
    description = "Ontology JVM service and review assets; explicitly configured, not deployed";
    mainProgram = "ontology-server";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
  };
}
