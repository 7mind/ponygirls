# Behavioral-Active / Blackbox-Atomic; owned native/PG/filesystem boundary, not CSI acceptance.
{ pkgs, manurePackage }:
let
  lib = pkgs.lib;
  sources = pkgs.callPackage ../pkg/chronicle/source.nix { };
  native = manurePackage.nativeArtifact;
  postgres = pkgs.postgresql_18.withPackages (p: [ p.pgvector ]);
  owned = import ./owned-postgres-environment.nix { inherit pkgs; };
  provision = pkgs.writeShellScript "portable-owned-database" ''
    exec ${pkgs.python3}/bin/python3 ${./provision-owned-database.py} "$@"
  '';
  probe = sources.manureTargetTests + "/manure/tests/portable_root_probe.py";
  runner = pkgs.writeShellScript "portable-native-guest-run" ''
    set -euo pipefail
    umask 077
    export PATH=${lib.makeBinPath [ pkgs.python3 pkgs.openssl pkgs.bubblewrap postgres pkgs.binutils pkgs.coreutils pkgs.gnugrep pkgs.diffutils ]}
    export TMPDIR=/srv/portable-volume
    export MANURE_OWNED_PORTABLE_VOLUME=/srv/portable-volume
    export PG_BIN=${owned.PG_BIN}
    export PG_POLICY=${owned.PG_POLICY}
    export PG_HBA=${owned.PG_HBA}
    export PG_CONFIGURATION=${owned.PG_CONFIGURATION}
    export PG_PROVIDER=${owned.PG_PROVIDER}
    export MANURE_TEST_PROVISION_COMMAND=${provision}
    export PONYGIRLS_TEST_PROVISION_SERVICE=manure
    export MANURE_TEST_SERVER_COMMAND_JSON='["${native}/libexec/manure-server"]'
    export PYTHONPATH=${sources.manureTargetTests}/manure:${sources.manureTargetTests}/manure/tests
    unset MANURE_TOKEN MANURE_TOKEN_FILE MANURE_URL MANURE_URL_FILE MANURE_CACHE_DIR MANURE_POSIX_LIBRARY
    cd ${sources.manureTargetTests}
    python3 manure/scripts/artifact-source.py > /srv/portable-volume/runtime-inputs.sha256
    cmp /srv/portable-volume/runtime-inputs.sha256 ${native}/share/manure/compiled-inputs.sha256
    readelf -lW ${native}/libexec/manure-server > /srv/portable-volume/elf-headers
    readelf -dW ${native}/libexec/manure-server > /srv/portable-volume/elf-dynamic
    ! grep -q INTERP /srv/portable-volume/elf-headers
    ! grep -q NEEDED /srv/portable-volume/elf-dynamic
    exec timeout --foreground --signal=TERM --kill-after=15s 600s python3 ${./with-owned-postgres.py} python3 ${probe}
  '';
in pkgs.testers.runNixOSTest {
  name = "manure-owned-portable-native";
  defaults = { lib, ... }: {
    virtualisation.useNixStoreImage = true;
    virtualisation.writableStore = true;
    virtualisation.writableStoreUseTmpfs = true;
    virtualisation.mountHostNixStore = false;
    virtualisation.useHostCerts = false;
    virtualisation.sharedDirectories = lib.mkForce { };
    virtualisation.vlans = lib.mkForce [ ];
    virtualisation.interfaces = lib.mkForce { };
  };
  sshBackdoor.enable = false;
  requiredFeatures.kvm = false;
  qemu.forceAccel = false;
  nodes.machine = { config, ... }: {
    system.stateVersion = "26.11";
    virtualisation.memorySize = 4096;
    virtualisation.diskSize = 4096;
    boot.kernelModules = [ "loop" ];
    users.users.fixture = { isNormalUser = true; uid = 1000; };
    environment.systemPackages = [ pkgs.python3 pkgs.e2fsprogs pkgs.util-linux postgres ];
    environment.etc."portable-runner".source = runner;
    assertions = [{
      assertion = config.virtualisation.useNixStoreImage && !config.virtualisation.mountHostNixStore
        && !config.virtualisation.useHostCerts && config.virtualisation.sharedDirectories == { }
        && config.virtualisation.vlans == [ ] && config.virtualisation.interfaces == { };
      message = "Portable ownership probe requires a contained guest, never host mounts or credentials";
    }];
  };
  testScript = ''
    import hashlib
    import json
    import os
    from pathlib import Path
    machine.start()
    machine.wait_for_unit("multi-user.target")
    machine.succeed("mount --make-rprivate /")
    machine.succeed("mkdir -p /srv/portable-volume; truncate -s 512M /var/lib/owned-portable.ext4; mkfs.ext4 -F /var/lib/owned-portable.ext4; mount -o loop /var/lib/owned-portable.ext4 /srv/portable-volume; mount --make-private /srv/portable-volume; chown fixture /srv/portable-volume")
    try:
        machine.succeed("su -s ${pkgs.bash}/bin/bash fixture -c /etc/portable-runner > /tmp/portable-probe.log 2>&1")
    finally:
        probe_log = machine.succeed("${pkgs.python3}/bin/python3 -c 'from pathlib import Path; print(Path(\"/tmp/portable-probe.log\").read_text())'")
        print(probe_log)
        Path(os.environ["out"]).mkdir(exist_ok=True)
        Path(os.environ["out"], "portable-native.log").write_text(probe_log)
    residue = machine.succeed("find /srv/portable-volume -mindepth 1 -maxdepth 1 -printf '%f\\n'")
    assert set(residue.splitlines()) == {"lost+found", "runtime-inputs.sha256", "elf-headers", "elf-dynamic"}
    machine.succeed("umount /srv/portable-volume")
    receipt = json.loads([line for line in probe_log.splitlines() if line.startswith('{"scope":')][-1])
    artifact = "${native}/libexec/manure-server"
    assert receipt["nativeElfSha256"] == hashlib.sha256(Path(artifact).read_bytes()).hexdigest()
    checks = sorted(key for key, value in receipt.items() if value is True)
    required = {"planOnlyNonAdopting", "applied", "freshPodExactReplay", "schemaMigrateAfterApplied",
                "portableNativeServeAndContent", "nativeAuthDenials", "nativeHeldRootDenial",
                "nativeCrossNetworkNamespaceRootDenial", "modeledForeignVolumeDenied",
                "nativeMarkerTamperDenied", "sameVolumeInodeCopyDenied", "nativeRestoredRootReopens",
                "nativeUnknownCaAndWrongSanDenied"}
    assert set(checks) == required and receipt["bindingBytes"] == [16, 76]
    receipt.update(artifactKind="native", artifact=artifact, runtimeSource="${sources.manureServer}",
                   testSource="${sources.manureTargetTests}", realKubernetesAcceptance=False, checks=checks)
    Path(os.environ["out"], "receipt.json").write_text(json.dumps(receipt, sort_keys=True) + "\n")
  '';
}
