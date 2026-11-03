{ lib, callPackage, runCommand, squishLib }:
let
  nativeArtifact = callPackage ../services/native.nix { inherit squishLib; service = "haystack"; };
  web = callPackage ./web.nix { };
in runCommand "haystack-0.1.0" {
  pname = "haystack";
  version = "0.1.0";
  passthru = { inherit nativeArtifact web; runtimeSource = nativeArtifact.runtimeSource; };
  meta = { description = "Native Scala Haystack server and current web client"; mainProgram = "haystack-server"; platforms = [ "x86_64-linux" ]; license = lib.licenses.mit; };
} ''
  mkdir -p "$out/bin" "$out/share/haystack"
  ln -s ${nativeArtifact}/libexec/haystack-server "$out/bin/haystack-server"
  ln -s ${web}/share/haystack/web "$out/share/haystack/web"
''
