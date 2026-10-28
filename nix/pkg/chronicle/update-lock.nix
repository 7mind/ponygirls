{ lib, callPackage, writeShellApplication, writeShellScriptBin, coursier, python3, bash, coreutils, gnugrep, lockfileGenerator }:
let
  tools = callPackage ./toolchain.nix { };
  src = (callPackage ./source.nix { }).development;
  coursierTool = coursier.override { jre = tools.graal; };
  sbtRunner = writeShellScriptBin "sbt" ''
    set -euo pipefail
    [[ "$1" == --batch ]]
    shift
    export JAVA_TOOL_OPTIONS="$SBT_OPTS -Dsbt.ci=true -Dsbt.global.base=$SBT_GLOBAL_BASE -Dsbt.ivy.home=$HOME/.ivy2 -Dcoursier.cache=$COURSIER_CACHE"
    exec ${tools.sbt}/bin/chronicle-sbt "$@"
  '';
  coursierRunner = writeShellScriptBin "cs" ''
    set -euo pipefail
    [[ "$1" == fetch ]]
    shift
    cache="''${COURSIER_CACHE:?}"
    export COURSIER_CACHE="''${SQUISH_TOOL_CACHE:?}"
    exec ${coursierTool}/bin/cs fetch --cache "$cache" --no-default --repository https://repo.maven.apache.org/maven2 "$@"
  '';
  generationPath = lib.makeBinPath [ sbtRunner coursierRunner tools.graal python3 bash coreutils ];
  generationTimeoutSeconds = 1200;
in
writeShellApplication {
  name = "chronicle-update-sbt-lock";
  runtimeInputs = [ coreutils gnugrep ];
  text = ''
    if [[ $# != 1 || "$1" != /* || -d "$1" || -L "$1" ]]; then
      echo 'Usage: chronicle-update-sbt-lock ABSOLUTE_LOCKFILE_PATH (not a directory or symlink)' >&2
      exit 2
    fi
    destination="$1"
    work="$(mktemp -d)"
    temporary=""
    cleanup() {
      local status="$1" directory="$2" publication="$3"
      if [[ -n "$publication" ]]; then
        echo "Removing unpublished temporary lock: $publication" >&2
        rm -f -- "$publication"
      fi
      if [[ "$status" == 0 ]]; then
        echo "Removing disposable lock-generation copy: $directory" >&2
        rm -rf -- "$directory"
      else
        echo "Lock generation failed; disposable copy retained: $directory" >&2
      fi
      exit "$status"
    }
    trap 'cleanup "$?" "$work" "$temporary"' EXIT
    mkdir -p "$work/home" "$work/tmp" "$work/tool-cache"
    cp -r ${src} "$work/project"
    chmod -R u+w "$work/project"
    cd "$work/project"
    env -i HOME="$work/home" TMPDIR="$work/tmp" PATH=${lib.escapeShellArg generationPath} \
      JAVA_HOME=${tools.graal} SQUISH_TOOL_CACHE="$work/tool-cache" \
      COURSIER_REPOSITORIES=https://repo.maven.apache.org/maven2 \
      timeout ${toString generationTimeoutSeconds} ${lockfileGenerator}/bin/squish-lockfile \
      lockfile-config.json --keep-temp --output "$work/deps.lock.json" \
      2>&1 >"$work/generator.stdout" | tee "$work/generator.log" >&2
    if grep -q 'Warning: Failed' "$work/generator.log"; then
      echo 'Configured dependency fetch failed; refusing to replace the lockfile' >&2
      exit 1
    fi
    env -i HOME="$work/home" ${python3}/bin/python3 -I - "$work/deps.lock.json" <<'PY'
    import json, sys
    from urllib.parse import urlsplit
    lock = json.load(open(sys.argv[1]))
    if lock['version'] != 1 or not lock['artifacts']:
        raise ValueError('Unsupported or empty dependency lock')
    urls = [artifact['url'] for artifact in lock['artifacts']]
    if urls != sorted(set(urls)):
        raise ValueError('Dependency URLs must be sorted and unique')
    if not all(urlsplit(url).scheme == 'https' and urlsplit(url).netloc == 'repo.maven.apache.org' and not urlsplit(url).query and not urlsplit(url).fragment and not urlsplit(url).username for url in urls):
        raise ValueError('Unexpected dependency artifact authority or URL')
    print('Validated public artifact lock:', len(urls), 'artifacts')
    PY
    if [[ -d "$destination" || -L "$destination" ]]; then
      echo 'Lock destination changed into a directory or symlink; refusing publication' >&2
      exit 1
    fi
    echo "Replacing dependency lock: $destination" >&2
    temporary="$(mktemp "$destination.XXXXXXXX")"
    install -m644 "$work/deps.lock.json" "$temporary"
    mv -fT -- "$temporary" "$destination"
    temporary=""
  '';
}
