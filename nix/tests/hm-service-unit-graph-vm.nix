# ACTUAL HM/user-manager graph, separate owned VM, no system provider or native
# HTTP/model acceptance. All Unix services intentionally share alice's UID.
{ pkgs, chronicleHmModule, agenticHmModule, sourceRevision }:
let
  lib=pkgs.lib;
  postgres=pkgs.postgresql_18.withPackages (p:[p.pgvector]);
  hmSrc=pkgs.home-manager.src;
  hmTree=builtins.fetchTree {type="tarball";url=hmSrc.url;narHash=hmSrc.outputHash;};
  adapter=pkgs.runCommand "hm-unit-graph-explicit-synthetic-cli" {} ''
    mkdir -p "$out/bin"
    for service in chronicle haystack manure; do
      cat > "$out/bin/$service-server" <<SCRIPT
#!${pkgs.runtimeShell}
export UNIT_GRAPH_PSQL=${postgres}/bin/psql
exec ${pkgs.python3}/bin/python3 ${./service-unit-graph-adapter.py} "$service" hm "\$@"
SCRIPT
      chmod +x "$out/bin/$service-server"
    done
  '';
  fixture="/home/alice/graph-fixtures";
  databaseNames=["chronicle" "haystack" "manure"];
  syntheticPassword=name:"synthetic-owned-hm-${name}-database-only";
  connection=name:{jdbcUrl="jdbc:postgresql://127.0.0.1:15434/${name}";user=name;passwordFile="${fixture}/${name}-database";readinessUnit="ponygirls-database-${name}.service";};
  sourceManifest=pkgs.writeText "hm-unit-graph-source-inputs.sha256" (lib.concatMapStrings (path:"${builtins.hashFile "sha256" path}  ${lib.removePrefix "${toString ../..}/" (toString path)}\n") [../hm/service-postgres.nix ../hm/chronicle-server.nix ../hm/agentic-services-server.nix ../hm/agentic-services-server-options.nix ../postgres/provider.py ./service-unit-graph-adapter.py ./service-unit-graph-snapshot.py ./service-unit-graph-controller.py ./hm-service-unit-graph-vm.nix ./hm-service-unit-graph-vm.py ./service-unit-graph-restart-evidence.py]);
in pkgs.testers.runNixOSTest {
  name="hm-shared-provider-actual-user-manager-lifecycle";
  requiredFeatures.kvm=false;qemu.forceAccel=false;globalTimeout=2100;
  sshBackdoor.enable=false;
  defaults={lib,...}:{
    virtualisation.useNixStoreImage=true;
    # Writable overlay is guest-owned tmpfs over the isolated EROFS disk image.
    # No host store/dirs/devices are shared or made writable.
    virtualisation.writableStore=true;virtualisation.writableStoreUseTmpfs=true;virtualisation.mountHostNixStore=false;
    virtualisation.useHostCerts=false;virtualisation.sharedDirectories=lib.mkForce {};
    virtualisation.vlans=lib.mkForce [];virtualisation.interfaces=lib.mkForce {};
    virtualisation.memorySize=2048;virtualisation.cores=2;
  };
  nodes.home={config,lib,...}:{
    imports=["${hmTree.outPath}/nixos"];
    system.stateVersion="26.11";
    assertions=[{assertion=config.virtualisation.writableStore && config.virtualisation.writableStoreUseTmpfs && !config.virtualisation.mountHostNixStore && config.virtualisation.sharedDirectories=={} && builtins.elem "ro" config.fileSystems."/nix/.ro-store".options && config.fileSystems."/nix/store".overlay.upperdir=="/nix/.rw-store/upper";message="Unit graph VM requires guest-only tmpfs overlay over isolated read-only store image, never host store/shares";}] ++ map (name:{assertion=config.home-manager.users.alice.ponygirls.servicePostgres.databases.${name}.passwordFile=="${fixture}/${name}-database";message="HM graph provider credential must match its named fixture";}) databaseNames ++ [{assertion=builtins.length (lib.unique (map syntheticPassword databaseNames))==3;message="HM graph requires three distinct synthetic database credentials";}];
    services.journald.settings.Journal.Storage="persistent";
    users.users.alice={isNormalUser=true;uid=1000;linger=true;};
    # Known distinct synthetic values ONLY. No real host HOME/secret is copied.
    system.activationScripts.hmGraphFixtures={deps=["users" "groups"];text=''
      install -d -m 0700 -o alice -g users ${fixture}
      ${lib.concatMapStrings (name: ''
        printf '%s\n' '${syntheticPassword name}' > ${fixture}/${name}-database
        chown alice:users ${fixture}/${name}-database
        chmod 0600 ${fixture}/${name}-database
      '') databaseNames}
      ${lib.concatMapStrings (name: ''
        printf '%s\n' '${lib.concatStrings (lib.genList (_:"A") 43)}' > ${fixture}/${name}-token
        chown alice:users ${fixture}/${name}-token
        chmod 0600 ${fixture}/${name}-token
      '') ["haystack" "manure" "crawl"]}
    '';};
    home-manager={useGlobalPkgs=true;useUserPackages=true;users.alice={lib,...}:{
      imports=[chronicleHmModule agenticHmModule];
      home.stateVersion="26.11";
      systemd.user.startServices="sd-switch";
      ponygirls.servicePostgres={enable=true;port=15434;stateDirectory="/home/alice/.local/state/graph-postgres-18";maxConnections=64;adminReserve=8;sharedBuffers="64MB";
        databases=lib.genAttrs ["chronicle" "haystack" "manure"] (name:{passwordFile="${fixture}/${name}-database";schemas=if name=="manure" then ["public" "manure"] else ["public"];});
      };
      smind.hm.services.chronicle={enable=true;package=adapter;stateDirectory="/home/alice/.local/state/graph-chronicle";
        database={port=15434;passwordFile="${fixture}/chronicle-database";readinessUnit="ponygirls-database-chronicle.service";};
        serverDependencies=[];setupDependencies=[];
        settings={listenHost="127.0.0.1";listenPort=47330;maxBodyBytes=8388608;allowedOrigin="https://unused.graph.test";};
      };
      smind.hm.services.agentic={enable=true;unitPrefix="ivm";stateDirectory="/home/alice/.local/state/graph-agentic";
        setupDependencies=[];host={hostname="localhost";address="127.0.0.1";scheme="http";};
        tls={certificateFile="${fixture}/unused-cert";keyFile="${fixture}/unused-key";};
        searxng.package=pkgs.hello;
        crawl4ai={package=pkgs.hello;tokenFile="${fixture}/crawl-token";};
        static.enable=false;
        haystack={package=adapter;database=connection "haystack";agentTokenFile="${fixture}/haystack-token";};
        manure={package=adapter;database=connection "manure";agentTokenFile="${fixture}/manure-token";allowInsecureHttp=true;};
      };
      # Unrelated crawler/search/proxy components are NOT this graph's subject.
      # Retain their real unit definitions but do not activate them in this VM.
      systemd.user.services=lib.genAttrs ["ivm-searxng" "ivm-crawl4ai-redis" "ivm-crawl4ai" "ivm-services-proxy"] (_:{Install.WantedBy=lib.mkForce [];});
    };};
    systemd.services.home-manager-alice={after=["user@1000.service"];requires=["user@1000.service"];};
    environment.etc."unit-graph-user/snapshot"={source=pkgs.writeShellScript "hm-unit-graph-snapshot" ''
      export UNIT_GRAPH_MANAGER=user
      exec ${pkgs.python3}/bin/python3 ${./service-unit-graph-snapshot.py} "$@"
    '';mode="0555";};
    environment.etc."unit-graph-user/restart-evidence"={source=pkgs.writeShellScript "hm-unit-graph-restart-evidence" ''exec ${pkgs.python3}/bin/python3 ${./service-unit-graph-restart-evidence.py} "$@"'';mode="0555";};
    specialisation.disabled-consumer.configuration.home-manager.users.alice.smind.hm.services.agentic.manure.enable=lib.mkForce false;
  };
  testScript=''
    import importlib.util, os, pathlib, sys
    def load_module(name, path):
        spec=importlib.util.spec_from_file_location(name,path)
        module=importlib.util.module_from_spec(spec)
        sys.modules[name]=module
        spec.loader.exec_module(module)
        return module
    fixture=load_module("hm_graph_fixture","${./hm-service-unit-graph-vm.py}")
    controller=load_module("hm_graph_controller","${./service-unit-graph-controller.py}")
    fixture.run_hm_graph(home,controller,
        fixture.Source("${sourceRevision}",pathlib.Path("${sourceManifest}")),
        pathlib.Path(os.environ["out"]),start_all)
  '';
}
