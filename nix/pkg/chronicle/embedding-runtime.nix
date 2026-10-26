{ lib, stdenv, fetchurl, python312, uv, autoPatchelfHook, makeWrapper
, zlib, libglvnd, numactl, rdma-core, openssl, libffi, gcc14
, tbb, openmpi, ucx, libfabric, pmix, libheif }:
let
  wheels = builtins.fromJSON (builtins.readFile ./embedding-wheels.json);
  sources = map (wheel: fetchurl {
    name = wheel.filename;
    inherit (wheel) url;
    sha256 = wheel.sha256;
  }) wheels;
  site = "${python312.sitePackages}";
in
assert stdenv.hostPlatform.system == "x86_64-linux";
stdenv.mkDerivation {
  pname = "chronicle-embedding-runtime";
  version = "0.32.0";
  dontUnpack = true;
  dontStrip = true;
  dontPatchELF = true;
  autoPatchelfFlags = [ "--preserve-origin" ];
  nativeBuildInputs = [ uv autoPatchelfHook makeWrapper ];
  buildInputs = [ (lib.getLib stdenv.cc.cc) zlib libglvnd numactl rdma-core openssl libffi python312
    tbb openmpi ucx libfabric pmix libheif ];
  autoPatchelfIgnoreMissingDeps = [ "libcuda.so.1" ];
  installPhase = ''
    runHook preInstall
    export UV_NO_CACHE=1 UV_PYTHON_DOWNLOADS=never
    uv venv --python ${python312}/bin/python3 "$out"
    mkdir wheelhouse
    ${lib.concatStringsSep "\n" (lib.zipListsWith (wheel: source: ''ln -s ${source} wheelhouse/${wheel.filename}'') wheels sources)}
    ${python312}/bin/python3 ${./embedding-install.py} "$out" ${uv}/bin/uv wheelhouse
    for abi in 4 5 6 7 9; do
      rm "$out/${site}/torchcodec/libtorchcodec_core$abi.so" \
         "$out/${site}/torchcodec/libtorchcodec_custom_ops$abi.so"
    done
    mkdir -p "$out/share/chronicle-embedding"
    cp ${./embedding-wheels.json} "$out/share/chronicle-embedding/wheels.json"
    cp ${./embedding-requirements.in} "$out/share/chronicle-embedding/requirements.in"
    cp ${./embedding-reference-constraints.txt} "$out/share/chronicle-embedding/reference-constraints.txt"
    runHook postInstall
  '';
  preFixup = ''
    ${python312}/bin/python3 ${./embedding-rpath.py} "$out" "$(command -v patchelf)"
    while IFS= read -r -d $'\0' directory; do
      addAutoPatchelfSearchPath "$directory"
    done < <(find "$out/${site}" -type d -print0)
    makeWrapper "$out/bin/vllm" "$out/bin/chronicle-embedding-runtime" \
      --set HF_HUB_OFFLINE 1 --set TRANSFORMERS_OFFLINE 1 \
      --set FLASHINFER_NO_DOWNLOAD 1 --set VLLM_NO_USAGE_STATS 1 --set DO_NOT_TRACK 1 \
      --set CC ${gcc14}/bin/gcc --set CXX ${gcc14}/bin/g++ \
      --set CUDA_HOME "$out/${site}/nvidia/cu13" \
      --set TRITON_PTXAS_PATH "$out/${site}/nvidia/cu13/bin/ptxas" \
      --set TRITON_PTXAS_BLACKWELL_PATH "$out/${site}/nvidia/cu13/bin/ptxas" \
      --prefix PATH : "${lib.makeBinPath [ gcc14 ]}:$out/bin:$out/${site}/nvidia/cu13/bin" \
      --run 'if [ -z "''${CHRONICLE_NVIDIA_DRIVER_LIB:-}" ] || [ -e "$CHRONICLE_NVIDIA_DRIVER_LIB/libc.so.6" ]; then echo "Set CHRONICLE_NVIDIA_DRIVER_LIB to a driver-only directory, not a system library directory." >&2; exit 1; fi; for driver in libcuda.so.1 libnvidia-ml.so.1 libnvidia-ptxjitcompiler.so.1; do if [ ! -r "$CHRONICLE_NVIDIA_DRIVER_LIB/$driver" ]; then echo "Missing host driver library: $driver" >&2; exit 1; fi; done' \
      --run 'export LD_LIBRARY_PATH="$CHRONICLE_NVIDIA_DRIVER_LIB''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"'
  '';
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    export HOME="$TMPDIR" HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
    export CUDA_HOME="$out/${site}/nvidia/cu13" PATH="$out/bin:$out/${site}/nvidia/cu13/bin:$PATH"
    export TRITON_PTXAS_PATH="$CUDA_HOME/bin/ptxas" TRITON_PTXAS_BLACKWELL_PATH="$CUDA_HOME/bin/ptxas"
    uv pip check --python "$out/bin/python"
    "$out/bin/python" ${./embedding-check.py}
    VLLM_TARGET_DEVICE=cpu "$out/bin/vllm" --help > "$out/share/chronicle-embedding/cli-help.txt"
    "$out/${site}/nvidia/cu13/bin/ptxas" --version
    runHook postInstallCheck
  '';
  passthru = { inherit wheels sources python312; };
  meta = {
    description = "Native offline wheel-backed vLLM CUDA 13.0 embedding runtime";
    platforms = [ "x86_64-linux" ];
    license = with lib.licenses; [ asl20 bsd3 unfreeRedistributable ];
    mainProgram = "chronicle-embedding-runtime";
  };
}
