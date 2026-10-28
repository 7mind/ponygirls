{ lib, pkgs, callPackage, python3, squishLib }:
let
  sources = callPackage ./source.nix { };
  environment = callPackage ./sbt-environment.nix { inherit squishLib; };
  nativeArtifact = callPackage ./native.nix { inherit squishLib; };
  backendValidation = callPackage ./backend-validation.nix { inherit squishLib; };
  protocolValidation = callPackage ./protocol-validation.nix { };
  web = callPackage ./web.nix { };
  inputs = {
    nativeArtifact = toString nativeArtifact;
    # Identity metadata must not realize every output in the derivation closure.
    nativeDerivation = builtins.unsafeDiscardOutputDependency nativeArtifact.drvPath;
    runtimeSource = toString sources.server;
    testSource = toString sources.backendTests;
    backendValidation = toString backendValidation;
    backendDerivation = builtins.unsafeDiscardOutputDependency backendValidation.drvPath;
    protocolValidation = toString protocolValidation;
    protocolDerivation = builtins.unsafeDiscardOutputDependency protocolValidation.drvPath;
    protocolSource = toString sources.protocol;
  };
  validationInputs = pkgs.writeText "chronicle-validation-inputs.json" (builtins.toJSON inputs);
  validationEvidence = pkgs.runCommand "chronicle-release-validation" { nativeBuildInputs = [ python3 ]; } ''
    mkdir -p "$out"
    python3 ${./validation-evidence.py} create --inputs ${validationInputs} --receipt "$out/validation.json"
  '';
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
    install -Dm644 target/chronicle-server.jar "$out/chronicle-server.jar"
  '';
in callPackage ./wrapper.nix {
  inherit nativeArtifact web validationEvidence validationInputs backendValidation protocolValidation offlineAssemblyCheck;
  documentation = sources.documentation;
  dependencies = environment.dependencies;
  toolchain = environment.tools;
}
