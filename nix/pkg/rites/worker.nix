# Rites worker: the Pi SDK host controller, brokered bubblewrap tool-runner
# and the run supervisor, compiled against the pinned pi-coding-agent Nix
# package. The output exposes bin/rites-worker with the coordinator CLI:
#
#   rites-worker WORKSPACE MODEL_CONFIG TIMEOUT_SECONDS
#
# stdin: one RunRequest frame; stdout: one RunResult frame.
#
# Consumed as:
#   rites-worker = pkgs.callPackage ./nix/pkg/rites/worker.nix {
#     pi-coding-agent = <the flake's pinned 1.4.0 package>;
#   };
{ lib, stdenvNoCC, nodejs, typescript, pi-coding-agent, bubblewrap
, bash, git, ripgrep, fd, coreutils, findutils, gnugrep, cacert
}:
let
  sdk = "${pi-coding-agent}/lib/node_modules/pi-monorepo";
  # Explicit toolchain visible inside the tool-runner sandbox PATH.
  toolchainPath = lib.concatMapStringsSep ":" (p: "${p}/bin") [
    nodejs bash git ripgrep fd coreutils findutils gnugrep
  ];
  # Keep only the rites sources the build consumes.
  ritesSrc = lib.cleanSourceWith {
    src = ./../../..;
    filter = path: type:
      let
        root = toString ./../../..;
        rel = lib.removePrefix (root + "/") (toString path);
        entries = [ "rites/package.json" "rites/tsconfig.json" "rites/protocol/protocol.ts" "rites/generated/typescript" "rites/worker" ];
        selected = entry: rel == entry || lib.hasPrefix "${entry}/" rel
          || (type == "directory" && lib.hasPrefix "${rel}/" entry);
        workerInput = !(lib.hasPrefix "rites/worker/" rel) || type == "directory"
          || lib.hasSuffix ".ts" rel || rel == "rites/worker/tsconfig.json";
      in toString path == root || (lib.cleanSourceFilter path type
        && !(builtins.elem (baseNameOf path) [ "node_modules" "target" "tests" ".cache" ".local" ])
        && workerInput && lib.any selected entries);
  };
in
stdenvNoCC.mkDerivation {
  pname = "rites-worker";
  version = "0.1.0";

  src = ritesSrc;

  nativeBuildInputs = [ nodejs typescript ];

  # Type-check and build both projects; the protocol project covers the
  # shared Baboon codecs the worker compiles against. A fixed absolute build
  # dir keeps every phase on the same tree.
  buildPhase = ''
    runHook preBuild

    mkdir -p "$NIX_BUILD_TOP/rites-build"
    cp -r rites/. "$NIX_BUILD_TOP/rites-build/"
    chmod -R u+w "$NIX_BUILD_TOP/rites-build"
    cd "$NIX_BUILD_TOP/rites-build"

    mkdir -p node_modules/@earendil-works node_modules/@types target/worker/node_modules/@earendil-works target/worker/node_modules/@types
    ln -s ${sdk} node_modules/@earendil-works/pi-coding-agent
    ln -s ${sdk}/node_modules/@earendil-works/pi-ai node_modules/@earendil-works/pi-ai
    ln -s ${sdk}/node_modules/@earendil-works/pi-agent-core node_modules/@earendil-works/pi-agent-core
    ln -s ${sdk}/node_modules/@types/node node_modules/@types/node
    ln -s ${sdk} target/worker/node_modules/@earendil-works/pi-coding-agent
    ln -s ${sdk}/node_modules/@earendil-works/pi-ai target/worker/node_modules/@earendil-works/pi-ai
    ln -s ${sdk}/node_modules/@earendil-works/pi-agent-core target/worker/node_modules/@earendil-works/pi-agent-core
    ln -s ${sdk}/node_modules/@types/node target/worker/node_modules/@types/node

    tsc -p tsconfig.json
    tsc -p worker/tsconfig.json

    runHook postBuild
  '';

  # The worker runtime dir the supervisor runs from and every tool-runner
  # sandbox binds read-only: worker code plus SDK resolution links. The
  # package.json makes Node treat the emitted .js files as ES modules.
  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/rites-worker $out/bin
    cp -r target/worker/worker target/worker/protocol target/worker/generated $out/lib/rites-worker/
    cp -r target/worker/node_modules $out/lib/rites-worker/node_modules
    echo '{"name":"@rites/worker-runtime","private":true,"type":"module"}' > $out/lib/rites-worker/package.json

    cat > $out/bin/rites-worker <<EOF
#!/usr/bin/env bash
set -euo pipefail
export RITES_NODE=${nodejs}/bin/node
export RITES_BWRAP=${bubblewrap}/bin/bwrap
export RITES_NIX_STORE=/nix/store
export RITES_WORKER_RUNTIME=$out/lib/rites-worker
export RITES_TOOLCHAIN_PATH="${toolchainPath}"
export RITES_CA_BUNDLE=${cacert}/etc/ssl/certs/ca-bundle.crt
exec ${nodejs}/bin/node $out/lib/rites-worker/worker/supervisor.js "\$@"
EOF
    chmod +x $out/bin/rites-worker

    runHook postInstall
  '';

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    cd "$NIX_BUILD_TOP/rites-build"
    tsc -p tsconfig.json --noEmit
    tsc -p worker/tsconfig.json --noEmit
    runHook postCheck
  '';

  # Sanity: the wrapper and the worker entries exist.
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    test -x $out/bin/rites-worker
    test -f $out/lib/rites-worker/worker/main.js
    test -f $out/lib/rites-worker/worker/tool-runner.js
    test -f $out/lib/rites-worker/worker/supervisor.js
    runHook postInstallCheck
  '';

  meta = {
    description = "Rites Pi SDK worker: brokered bubblewrap tool-runner agent worker";
    license = lib.licenses.mit;
    mainProgram = "rites-worker";
  };
}
