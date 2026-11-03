# Behavioral-Active / Blackbox-GoodCommunication. Specified lifecycle matrix.
# ACTUAL exported module unit graphs/configs/credentials and real PG; explicitly
# synthetic app CLI adapters only, never native runtime/protocol acceptance.
# No host activation, store/dir/socket sharing, network bridge/TAP or live data.
{ pkgs, nixpkgs, chronicleModule, haystackModule, manureModule, sourceRevision }:
let
  lib=nixpkgs.lib;
  postgres=pkgs.postgresql_18.withPackages (p:[p.pgvector]);
  adapter=tag: pkgs.runCommand "unit-graph-explicit-synthetic-app-adapter-${tag}" {} ''
    mkdir -p "$out/bin"
    for service in chronicle haystack manure; do
      cat > "$out/bin/$service-server" <<EOF
#!${pkgs.runtimeShell}
export UNIT_GRAPH_PSQL=${postgres}/bin/psql
exec ${pkgs.python3}/bin/python3 ${./service-unit-graph-adapter.py} "$service" ${lib.escapeShellArg tag} "\$@"
EOF
      chmod +x "$out/bin/$service-server"
    done
  '';
  paths=[../nixos/service-postgres.nix ../hm/service-postgres.nix ../nixos/chronicle.nix ../nixos/haystack.nix ../nixos/manure.nix ../postgres/options.nix ../postgres/policy.nix ../postgres/provider.py ./service-unit-graph-vm.nix ./service-unit-graph-adapter.py ./service-unit-graph-snapshot.py ./service-unit-graph-vm.py ./service-unit-graph-controller.py];
  sourceManifest=pkgs.writeText "service-unit-graph-source-inputs.sha256" (lib.concatMapStrings (path:"${builtins.hashFile "sha256" path}  ${lib.removePrefix "${toString ../..}/" (toString path)}\n") paths);
  connection=name:{jdbcUrl="jdbc:postgresql://127.0.0.1:15434/${name}";user=name;passwordFile="/etc/unit-graph/${name}-database";readinessUnit="ponygirls-database-${name}.service";};
in pkgs.testers.runNixOSTest {
  name="shared-provider-actual-module-unit-lifecycle";
  defaults={lib,...}:{
    virtualisation.useNixStoreImage=true;
    virtualisation.mountHostNixStore=false;
    virtualisation.useHostCerts=false;
    virtualisation.sharedDirectories=lib.mkForce {};
    virtualisation.vlans=lib.mkForce [];
    virtualisation.interfaces=lib.mkForce {};
    virtualisation.memorySize=2048;
    virtualisation.cores=2;
  };
  sshBackdoor.enable=false;
  # Prefer acceleration if available; TCG is still a real VM, never a skip.
  qemu.forceAccel=false;
  # Pinned nixos/lib/testing/run.nix defaults this independently of forceAccel.
  # Its documented emulated-execution switch is an honest TCG capability, not a
  # fake host KVM feature and not a skip. The real guest still has to boot/run.
  requiredFeatures.kvm=false;
  globalTimeout=2100;
  nodes.server={config,lib,...}:{
    imports=[chronicleModule haystackModule manureModule];
    system.stateVersion="26.11";
    ponygirls.servicePostgres={
      enable=true;
      maxConnections=64;adminReserve=8;sharedBuffers="64MB";
      databases=lib.genAttrs ["chronicle" "haystack" "manure"] (name:{
        passwordFile="/etc/unit-graph/${name}-database";
        schemas=if name=="manure" then ["public" "manure"] else ["public"];
      });
    };
    smind.services.chronicle={
      enable=true;package=adapter "base";publicUrl="https://chronicle.graph.test";
      database=connection "chronicle";
      proxy.enable=false;
      annotation={endpoint="http://127.0.0.1:1/not-called";model="unused-graph-only";revision="graph-only";credentialFile="/etc/unit-graph/unused-model";requestPolicy="strict-json-schema";};
      embedding={endpoint="http://127.0.0.1:1/not-called";model="unused-graph-only";revision="graph-only";credentialFile="/etc/unit-graph/unused-model";dimensions=3;queryPrefix="";documentPrefix="";};
      users.op={login="operator";passwordHashFile="/etc/unit-graph/unused-password-hash";};
    };
    smind.services.haystack={
      enable=true;package=adapter "base";publicUrl="https://haystack.graph.test";
      database=connection "haystack";
      proxy={enable=false;openFirewall=false;};
      users.op={type="human";tokens.graph.tokenHashFile="/etc/unit-graph/synthetic-token-hash";};
    };
    smind.services.manure={
      enable=true;package=adapter "base";apiOrigin="https://manure.graph.test";contentMode="path";
      database=connection "manure";
      proxy.enable=false;
      users.op={type="human";tokens.graph.tokenHashFile="/etc/unit-graph/synthetic-token-hash";};
    };
    environment.etc=(lib.genAttrs (map (n:"unit-graph/${n}-database") ["chronicle" "haystack" "manure"]) (_:{text="owned-disposable-graph-only-database-password\n";mode="0400";}))//{
      "unit-graph/unused-model"={text="not-used-no-model-process\n";mode="0400";};
      "unit-graph/unused-password-hash"={text="synthetic-adapter-never-authenticates\n";mode="0400";};
      "unit-graph/synthetic-token-hash"={text=lib.concatStrings (lib.genList (_:"a") 64)+"\n";mode="0400";};
      "unit-graph/snapshot"={source=pkgs.writeShellScript "unit-graph-snapshot" ''exec ${pkgs.python3}/bin/python3 ${./service-unit-graph-snapshot.py} "$@"'';mode="0555";};
    };
    specialisation={
      app-package.configuration.smind.services.haystack.package=lib.mkForce (adapter "alternate");
      disabled-consumer.configuration.smind.services.manure.enable=lib.mkForce false;
    };
  };
  testScript=''
    SOURCE_REVISION = "${sourceRevision}"
    SOURCE_MANIFEST = "${sourceManifest}"
    CONTROLLER_SOURCE_PATH = "${./service-unit-graph-controller.py}"
    exec(compile(open("${./service-unit-graph-vm.py}").read(), "service-unit-graph-vm.py", "exec"))
  '';
}
