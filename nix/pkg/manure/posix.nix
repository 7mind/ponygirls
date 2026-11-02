{ lib, stdenv, pkgsStatic, callPackage }:
let
  tools = callPackage ../chronicle/toolchain.nix { };
  source = (callPackage ../chronicle/source.nix { }).manurePosix;
  library = buildStdenv: static: buildStdenv.mkDerivation {
    pname = "manure-posix-${if static then "musl-static" else "jvm-shared"}";
    version = "1";
    src = source;
    dontConfigure = true;
    buildPhase = ''
      runHook preBuild
      $CC -std=c11 -O2 -Wall -Wextra -Werror -fPIC \
        -I${tools.graal}/include -I${tools.graal}/include/linux \
        -c manure/server/src/main/c/posix_native.c -o posix_native.o
      ${if static then "$AR rcs libmanure_posix.a posix_native.o" else "$CC -shared -Wl,-z,defs,-z,relro,-z,now posix_native.o -o libmanure_posix.so"}
      runHook postBuild
    '';
    installPhase = ''
      install -Dm644 libmanure_posix.${if static then "a" else "so"} "$out/lib/libmanure_posix.${if static then "a" else "so"}"
    '';
    meta.platforms = [ "x86_64-linux" ];
  };
in {
  shared = library stdenv false;
  static = library pkgsStatic.stdenv true;
}
