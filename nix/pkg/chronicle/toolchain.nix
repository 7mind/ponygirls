{ lib, stdenvNoCC, fetchurl, writeShellScriptBin, writeText, graalvmPackages, postgresql_18 }:
let
  binaries = {
    x86_64-linux = {
      name = "baboon-linux-amd64";
      hash = "sha256-ZHD1mdR8w/aF78TM9N3MhJK/0NzYeoi/du17/uD3fzY=";
    };
    aarch64-darwin = {
      name = "baboon-macos-aarch64-14";
      hash = "sha256-5dnrem6+iD+BlzdCH3pGxHdCI1IZwijkAxf8wkMJGzc=";
    };
  };
  binary = binaries.${stdenvNoCC.hostPlatform.system};
  baboon = stdenvNoCC.mkDerivation {
    pname = "chronicle-baboon";
    version = "0.0.198";
    src = fetchurl {
      url = "https://github.com/7mind/baboon/releases/download/v0.0.198/${binary.name}";
      inherit (binary) hash;
    };
    dontUnpack = true;
    dontStrip = true;
    installPhase = ''
      install -Dm755 "$src" "$out/bin/baboon"
    '';
    meta = {
      description = "Pinned Baboon compiler for Chronicle wire models";
      license = lib.licenses.mit;
      platforms = builtins.attrNames binaries;
      mainProgram = "baboon";
    };
  };
  launcher = fetchurl {
    url = "https://repo.maven.apache.org/maven2/org/scala-sbt/sbt-launch/1.13.1/sbt-launch-1.13.1.jar";
    hash = "sha256-tzqrwDektuBrXQfTbt0CapfDrBHC9+DW9YHY76R0cug=";
  };
  repositories = writeText "chronicle-sbt-repositories" ''
    [repositories]
    local
    maven-central: https://repo.maven.apache.org/maven2/
  '';
  graal = if stdenvNoCC.hostPlatform.isLinux then graalvmPackages.graalvm-ce-musl else graalvmPackages.graalvm-ce;
  nativeImageFlags = lib.optionals stdenvNoCC.hostPlatform.isLinux [ "--static" "--libc=musl" ];
  postgres = postgresql_18.withPackages (p: [ p.pgvector ]);
  sbt = writeShellScriptBin "chronicle-sbt" ''
    exec ${graal}/bin/java \
      -Dsbt.override.build.repos=true \
      -Dsbt.repository.config=${repositories} \
      -Dsbt.supershell=false -Dsbt.server.autostart=false \
      -jar ${launcher} "$@"
  '';
in
{
  inherit baboon launcher repositories graal nativeImageFlags postgres sbt;
}
