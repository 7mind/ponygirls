{ lib, pkgs, callPackage, squishLib }:
let
  sources = callPackage ./source.nix { };
  environment = callPackage ./sbt-environment.nix { inherit squishLib; };
  nativeArtifact = callPackage ./native.nix { inherit squishLib; };
  backendValidation = callPackage ./backend-validation.nix { inherit squishLib; };
  protocolValidation = callPackage ./protocol-validation.nix { };
  web = callPackage ./web.nix { };
  offlineAssemblyCheck = pkgs.runCommand "chronicle-offline-assembly" {
    nativeBuildInputs = [ environment.tools.graal ];
    LANG = "C.UTF-8";
    LC_ALL = "C.UTF-8";
  } ''
    cp -r ${sources.server} source
    chmod -R u+w source
    cd source
    ${environment.setup}
    ${environment.assemble}
    install -Dm644 chronicle/target/chronicle-server.jar "$out/chronicle-server.jar"
  '';
in callPackage ./wrapper.nix {
  inherit nativeArtifact web backendValidation protocolValidation offlineAssemblyCheck;
  documentation = sources.documentation;
  dependencies = environment.dependencies;
  toolchain = environment.tools;
}
