{ pkgs, squishLib }:
let
  runtime = pkgs.runCommand "chronicle-gate-fixture-runtime" { } "mkdir -p $out";
  tests = pkgs.runCommand "chronicle-gate-fixture-tests" { } ''
    mkdir -p "$out/scripts"
    echo chronicle.SyntheticTest > "$out/scripts/fast-suites.txt"
  '';
  protocolSource = pkgs.runCommand "chronicle-gate-fixture-protocol-source" { } "mkdir -p $out";
  native = pkgs.runCommand "chronicle-gate-fixture-native" { } ''
    mkdir -p "$out/libexec"
    printf '\177ELFsynthetic-not-executed' > "$out/libexec/chronicle-server"
    chmod +x "$out/libexec/chronicle-server"
  '';
  documentation = pkgs.runCommand "chronicle-gate-fixture-docs" { } ''
    mkdir -p "$out/models" "$out/migrations"
    echo synthetic > "$out/README.md"
  '';
  tools = pkgs.callPackage ../pkg/chronicle/toolchain.nix { };
  scenario = mode:
    let
      backend = pkgs.runCommand "chronicle-gate-fixture-backend-${mode}" { } (if mode == "failed-backend" then ''
        echo 'CONTROL: required fast backend validation failed' >&2
        exit 1
      '' else ''
        mkdir -p "$out"
        cat > "$out/backend.json" <<'JSON'
        ${builtins.toJSON {
          schemaVersion = if mode == "full-backend-claim" then 1 else 2;
          status = "passed";
          scope = if mode == "full-backend-claim" then "full-unfiltered-postgres-protocol-concurrency" else "fast-explicit-suite-subset";
          runtimeSource = toString runtime; testSource = toString tests;
          tests = 2; suites = 1; failed = 0; errors = 0; skipped = 0;
          suiteCounts."chronicle.SyntheticTest" = 2;
          selectedSuites = [ "chronicle.SyntheticTest" ]; discoveredSuites = 2;
        }}
        JSON
        ${pkgs.lib.optionalString (mode != "missing-inventory") ''
          printf 'chronicle.ManualPostgresTest\nchronicle.SyntheticTest\n' > "$out/validation-inventory.txt"
        ''}
      '');
      protocol = pkgs.runCommand "chronicle-gate-fixture-protocol-${mode}" { } (if mode == "failed-protocol" then ''
        echo 'CONTROL: single-version protocol validation failed' >&2
        exit 1
      '' else ''
        mkdir -p "$out"
        cat > "$out/protocol.json" <<'JSON'
        ${builtins.toJSON { schemaVersion = 2; status = "passed"; versions = 1; apiVersion = "1.9.0"; fixtureGroups = 16; protocolSource = toString protocolSource; }}
        JSON
      '');
      web = pkgs.runCommand "chronicle-gate-fixture-web-${mode}" { } (if mode == "failed-web" then ''
        echo 'CONTROL: mandatory web validation failed' >&2
        exit 1
      '' else "mkdir -p $out/share/chronicle/web");
      fakePkgs = pkgs // {
        runCommand = name: attrs: script:
          if name == "chronicle-fast-validation" && builtins.elem mode [ "missing-receipt" "malformed-receipt" "wrong-digest" "wrong-source" "wrong-schema" "wrong-claim" ] then
            pkgs.runCommand "chronicle-gate-fixture-receipt-${mode}" (attrs // { nativeBuildInputs = (attrs.nativeBuildInputs or [ ]) ++ [ pkgs.python3 ]; }) (if mode == "missing-receipt" then "mkdir -p $out" else if mode == "malformed-receipt" then ''
              mkdir -p "$out"
              echo '{' > "$out/validation.json"
            '' else script + ''
              python3 - "$out/validation.json" <<'PY'
              import json,sys
              from pathlib import Path
              p=Path(sys.argv[1]);value=json.loads(p.read_text())
              if '${mode}'=='wrong-digest': value['nativeSha256']='0'*64
              elif '${mode}'=='wrong-source': value['inputs']['runtimeSource']='/nix/store/invalid-source-control'
              elif '${mode}'=='wrong-schema': value['schemaVersion']=1
              else: value['claim']='exact-artifact-bound-to-full-source-validation'
              p.write_text(json.dumps(value))
              PY
            '')
          else pkgs.runCommand name attrs script;
      };
      call = file: args:
        if baseNameOf file == "source.nix" then { server = runtime; backendTests = tests; protocol = protocolSource; inherit documentation; }
        else if baseNameOf file == "native.nix" then native
        else if baseNameOf file == "backend-validation.nix" then backend
        else if baseNameOf file == "protocol-validation.nix" then protocol
        else if baseNameOf file == "web.nix" then web
        else if baseNameOf file == "sbt-environment.nix" then { inherit tools; dependencies = runtime; setup = "exit 1"; assemble = "exit 1"; }
        else pkgs.callPackage file args;
    in pkgs.callPackage ../pkg/chronicle/server.nix { pkgs = fakePkgs; callPackage = call; inherit squishLib; };
in builtins.listToAttrs (map (mode: { name = mode; value = scenario mode; }) [
  "good" "failed-backend" "failed-web" "missing-receipt" "malformed-receipt" "wrong-digest" "wrong-source"
  "failed-protocol" "full-backend-claim" "missing-inventory" "wrong-schema" "wrong-claim"
])
