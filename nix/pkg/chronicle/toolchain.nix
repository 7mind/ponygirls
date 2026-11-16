{ lib, stdenvNoCC, fetchurl, writeShellScriptBin, writeText, postgresql_18 }:
let
  # Audited provider-owned Graal release pin for the manure/chronicle native
  # toolchain. graalvmPackages used to be injected from the consuming flake's
  # nixpkgs, so one ponygirls rev built against different Graal releases
  # depending on who evaluated it: ponygirls' own pin (nixpkgs f4a03c00)
  # provides the audited GraalVM CE 25.4.4.1.1 (release dump:
  # IMPLEMENTOR="GraalVM Community" GRAALVM_VERSION="25.4.4.1.1"
  # JAVA_VERSION="25.0.4.1.1" JAVA_RUNTIME_VERSION="25.0.4.1.1+1-jvmci-25.4-b23",
  # store graalvm-ce-25.4.4.1.1), while consumers with other nixpkgs pins got
  # un-audited builds that the POSIX guard refused. This snapshot import
  # pins the toolchain to the audited derivation under EVERY consuming flake
  # (immune to follows and overlay drift) and fail-closes on any other
  # release. See 49b5d838 for the guard side and the acceptance evidence.
  auditedGraalRelease = "25.4.4.1.1";
  auditedPkgs = import (builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/f4a03c008967841f2a0b3cb7c436fc6fc31671f6.tar.gz";
    sha256 = "sha256-ziZn2PvCJE5JEEpqTdxXwJpPB+L3YqoCpTAMCzyaP3U=";
  }) {
    # Explicit system: flake evaluation is pure and has no
    # builtins.currentSystem (nixpkgs' impure.nix fallback would abort
    # with "attribute 'currentSystem' missing").
    system = stdenvNoCC.hostPlatform.system;
  };
  auditedGraalvmPackages = auditedPkgs.graalvmPackages;
  binaries = {
    x86_64-linux = {
      name = "baboon-linux-amd64";
      hash = "sha256-HQ3r93G4oiM05oz35vmdVUQ/JFEnnq43E60bFVqWz8Q=";
    };
    aarch64-darwin = {
      name = "baboon-macos-aarch64-14";
      hash = "sha256-BC9+PN3OTN0rbae5vw3C16MWg/b1CyPRXy6QL4FVMn4=";
    };
  };
  binary = binaries.${stdenvNoCC.hostPlatform.system};
  baboon = stdenvNoCC.mkDerivation {
    pname = "chronicle-baboon";
    version = "0.0.200";
    src = fetchurl {
      url = "https://github.com/7mind/baboon/releases/download/v0.0.200/${binary.name}";
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
    url = "https://repo.maven.apache.org/maven2/org/scala-sbt/sbt-launch/2.0.12/sbt-launch-2.0.12.jar";
    hash = "sha256-0XOuS9brB/1wsAChLLcnXHqrJsZX48mTL0l9lXjXHrE=";
  };
  repositories = writeText "chronicle-sbt-repositories" ''
    [repositories]
    local
    maven-central: https://repo.maven.apache.org/maven2/
  '';
  graal =
    let g = if stdenvNoCC.hostPlatform.isLinux then auditedGraalvmPackages.graalvm-ce-musl else auditedGraalvmPackages.graalvm-ce;
    in assert lib.assertMsg (g.version == auditedGraalRelease)
      "native toolchain: audited Graal CE ${auditedGraalRelease} required, resolved ${g.version}"; g;
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
  inherit baboon launcher repositories graal nativeImageFlags postgres sbt auditedPkgs;
}
