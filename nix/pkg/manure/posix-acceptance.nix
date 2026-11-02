{ runCommand, callPackage, python3, binutils, coreutils, squishLib }:
let
  source = (callPackage ../chronicle/source.nix { }).manureAcceptance;
  environment = callPackage ../chronicle/sbt-environment.nix { inherit squishLib; };
  bridge = callPackage ./posix.nix { };
in runCommand "manure-posix-jvm-static-musl-acceptance" {
  nativeBuildInputs = [ environment.tools.graal python3 binutils coreutils ];
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
  MANURE_POSIX_LIBRARY = "${bridge.shared}/lib/libmanure_posix.so";
  MANURE_POSIX_STATIC = "${bridge.static}/lib";
  passthru = { acceptanceSource = source; inherit bridge; };
} ''
  cp -r ${source} source
  chmod -R u+w source
  cd source
  ${environment.setup}
  mkdir -p "$out"
  bash scripts/manure-probe-classpath.sh "$PWD/classpath"
  classpath=$(cat classpath)
  java --enable-native-access=ALL-UNNAMED -cp "$classpath" \
    manure.storage.FilesystemCapabilityProbe --shared "$MANURE_POSIX_LIBRARY" > "$out/jvm.log" 2>&1 || {
    cat "$out/jvm.log"; exit 1;
  }
  cat "$out/jvm.log"
  bash scripts/manure-native-image.sh "$classpath" "$out/manure-posix-probe" > "$out/build.log" 2>&1 || {
    cat "$out/build.log"; exit 1;
  }
  # Header audit is necessary but not sufficient: execute that exact ELF below.
  readelf -lW "$out/manure-posix-probe" > "$out/elf-program-headers.txt"
  readelf -dW "$out/manure-posix-probe" > "$out/elf-dynamic.txt"
  ! grep -q INTERP "$out/elf-program-headers.txt"
  ! grep -q NEEDED "$out/elf-dynamic.txt"
  "$out/manure-posix-probe" --linked > "$out/native.log" 2>&1 || {
    cat "$out/native.log"; exit 1;
  }
  cat "$out/native.log"
  # Validation code is separate from the native executable's filtered sources.
  python3 ${../../../scripts/manure-acceptance-report.py} \
    --jvm "$out/jvm.log" --native "$out/native.log" --source '${source}' \
    --toolchain '${environment.tools.graal}' --artifact "$out/manure-posix-probe" \
    --artifact "$MANURE_POSIX_LIBRARY" --artifact "$MANURE_POSIX_STATIC/libmanure_posix.a" \
    --output "$out/acceptance.json"
  sha256sum "$out/manure-posix-probe" "$MANURE_POSIX_LIBRARY" \
    "$MANURE_POSIX_STATIC/libmanure_posix.a" > "$out/artifacts.sha256"
  printf '%s\n' '${source}' > "$out/acceptance-source"
  printf '%s\n' '${environment.tools.graal}' > "$out/toolchain"
  printf '%s\n' 'Primitive POSIX/JNI acceptance only; no complete server, PostgreSQL migration, publish/recovery or deployment claim.' > "$out/scope"
''
