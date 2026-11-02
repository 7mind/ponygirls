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
      mkdir generated classes
      ${tools.graal}/bin/javac -Xlint:all -Werror -h generated -d classes \
        manure/server/src/main/java/manure/storage/NativeFailure.java \
        manure/server/src/main/java/manure/storage/PosixNative.java
      cmp generated/manure_storage_PosixNative.h manure/server/src/main/c/manure_storage_PosixNative.h
      $CC -std=c11 -O2 -Wall -Wextra -Werror -Wconversion -Wsign-conversion \
        -Wshadow -Wformat=2 -Wstrict-prototypes -Wmissing-prototypes -fPIC \
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
