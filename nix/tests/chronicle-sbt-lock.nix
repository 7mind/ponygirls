{ pkgs }:
let
  artifact = { url = "https://repo.maven.apache.org/maven2/example/artifact.jar"; sha256 = pkgs.lib.concatStrings (pkgs.lib.replicate 52 "0"); };
  valid = { version = 1; artifacts = [ artifact ]; };
  fixtures = [
    { name = "valid"; value = valid; optimization = "0"; accepted = true; replaceDestination = ""; }
    { name = "valid-optimized"; value = valid; optimization = "1"; accepted = true; replaceDestination = ""; }
    { name = "foreign"; value = valid // { artifacts = [ (artifact // { url = "https://not-maven.example.invalid/artifact.jar"; }) ]; }; optimization = "0"; accepted = false; replaceDestination = ""; }
    { name = "foreign-optimized"; value = valid // { artifacts = [ (artifact // { url = "https://not-maven.example.invalid/artifact.jar"; }) ]; }; optimization = "1"; accepted = false; replaceDestination = ""; }
    { name = "empty-optimized"; value = valid // { artifacts = [ ]; }; optimization = "1"; accepted = false; replaceDestination = ""; }
    { name = "version-optimized"; value = valid // { version = 2; }; optimization = "1"; accepted = false; replaceDestination = ""; }
    { name = "duplicate-optimized"; value = valid // { artifacts = [ artifact artifact ]; }; optimization = "1"; accepted = false; replaceDestination = ""; }
    { name = "directory"; value = valid; optimization = "0"; accepted = false; replaceDestination = "directory"; }
    { name = "symlink"; value = valid; optimization = "0"; accepted = false; replaceDestination = "symlink"; }
  ];
  runCase = fixture:
    let
      content = pkgs.writeText "${fixture.name}-lock.json" (builtins.toJSON fixture.value);
      generator = pkgs.writeShellScriptBin "squish-lockfile" ''
        set -euo pipefail
        output=""
        while (( $# > 0 )); do
          if [[ "$1" == --output ]]; then output="$2"; shift 2; else shift; fi
        done
        test -n "$output"
        cp ${content} "$output"
        ${pkgs.lib.optionalString (fixture.replaceDestination != "") ''
          target="$(dirname "$(dirname "$output")")/destination.json"
          echo 'Replacing only the synthetic test destination to reproduce a publication race' >&2
          rm -f -- "$target"
          ${if fixture.replaceDestination == "directory" then ''mkdir "$target"'' else ''
            mkdir "$(dirname "$target")/other"
            ln -s "$(dirname "$target")/other" "$target"
          ''}
        ''}
      '';
      updater = pkgs.callPackage ../pkg/chronicle/update-lock.nix { lockfileGenerator = generator; };
    in ''
      root="$TMPDIR/${fixture.name}"
      mkdir "$root"
      printf 'retained' > "$root/destination.json"
      if TMPDIR="$root" PYTHONOPTIMIZE=${fixture.optimization} ${updater}/bin/chronicle-update-sbt-lock "$root/destination.json" >"$root/result.log" 2>&1; then
        ${if fixture.accepted then ''
          cmp ${content} "$root/destination.json"
          echo 'PASS ${fixture.name}'
        '' else ''
          echo 'FAIL ${fixture.name}: invalid lock or changed destination was accepted'
          failures=$((failures+1))
        ''}
      else
        ${if fixture.accepted then ''
          echo 'FAIL ${fixture.name}: valid lock was rejected'
          failures=$((failures+1))
        '' else ''
          ${pkgs.lib.optionalString (fixture.replaceDestination == "") ''test "$(<"$root/destination.json")" == retained''}
          echo 'PASS ${fixture.name}'
        ''}
      fi
    '';
in
pkgs.runCommand "chronicle-sbt-lock-test" { } ''
  failures=0
  ${pkgs.lib.concatMapStringsSep "\n" runCase fixtures}
  test "$failures" -eq 0
  touch "$out"
''
