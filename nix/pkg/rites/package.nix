{ lib, callPackage, symlinkJoin, makeWrapper, git, bash, coreutils, squishLib, pi-coding-agent }:
let
  native = callPackage ./native.nix { inherit squishLib; };
  worker = callPackage ./worker.nix { inherit pi-coding-agent; };
  web = callPackage ./web.nix { };
in symlinkJoin {
  name = "rites-0.1.0";
  paths = [ native worker web ];
  nativeBuildInputs = [ makeWrapper ];
  postBuild = ''
    mkdir -p "$out/bin"
    makeWrapper ${native}/libexec/rites-server "$out/bin/rites-server" \
      --set RITES_WEB_ROOT ${web}/share/rites/web \
      --prefix PATH : ${lib.makeBinPath [ worker git bash coreutils ]}
    ln -s rites-server "$out/bin/rites"
  '';
  passthru = { nativeArtifact = native; inherit worker web; };
  meta = {
    description = "Scheduled repository agents with a native coordinator and isolated Pi SDK workers";
    mainProgram = "rites-server";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
  };
}
