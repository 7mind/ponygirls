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
    manure.storage.FilesystemCapabilityProbe --shared "$MANURE_POSIX_LIBRARY" > "$out/jvm.log" 2>&1
  cat "$out/jvm.log"
  bash scripts/manure-native-image.sh "$classpath" "$out/manure-posix-probe" > "$out/build.log" 2>&1 || {
    cat "$out/build.log"; exit 1;
  }
  # Header audit is necessary but not sufficient: execute that exact ELF below.
  readelf -lW "$out/manure-posix-probe" > "$out/elf-program-headers.txt"
  readelf -dW "$out/manure-posix-probe" > "$out/elf-dynamic.txt"
  ! grep -q INTERP "$out/elf-program-headers.txt"
  ! grep -q NEEDED "$out/elf-dynamic.txt"
  "$out/manure-posix-probe" --linked > "$out/native.log" 2>&1
  cat "$out/native.log"
  # Same discovered, nonempty behavior inventory on both runtimes, no skips.
  grep '^PASS: ' "$out/jvm.log" > jvm-cases
  grep '^PASS: ' "$out/native.log" > native-cases
  test -s jvm-cases
  cmp jvm-cases native-cases
  sha256sum "$out/manure-posix-probe" "$MANURE_POSIX_LIBRARY" \
    "$MANURE_POSIX_STATIC/libmanure_posix.a" > "$out/artifacts.sha256"
  printf '%s\n' '${source}' > "$out/acceptance-source"
  printf '%s\n' '${environment.tools.graal}' > "$out/toolchain"
  printf '%s\n' 'Primitive POSIX/JNI acceptance only; no complete server, PostgreSQL migration, publish/recovery or deployment claim.' > "$out/scope"
''
