# Controlled configured-wrapper contracts; real CLI/server acceptance is separate.
{ pkgs, chronicleModule, haystackModule }:
let
  lib = pkgs.lib;
  fakeCLI = service: pkgs.writeShellScriptBin service ''
    if [[ "''${1:-}" == --help ]]; then
      printf '%s\n' '${service} help'
      exit 0
    fi
    exec ${pkgs.python3}/bin/python3 - <<'PY'
    import json, os
    print(json.dumps({key: os.environ.get('${lib.toUpper service}_' + key) for key in ('URL', 'TOKEN', 'TOKEN_FILE')}))
    PY
  '';
  evaluate = service: module: enabled: lib.evalModules {
    specialArgs = {
      osConfig = null;
      pkgs = pkgs // {
        callPackage = path: args:
          if lib.hasSuffix "/${service}/client.nix" (toString path)
          then if enabled then fakeCLI service else throw "disabled ${service} instantiated its client"
          else pkgs.callPackage path args;
      };
    };
    modules = [
      module
      ({ lib, ... }: {
        options = {
          assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
          programs.mcp.servers = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
          programs.codex.settings = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
          smind.hm.dev.llm.enable = lib.mkOption { type = lib.types.bool; default = false; };
          smind.hm.dev.llm.yolo.validatedSessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
          smind.hm.dev.llm.pi.mcpServerOverrides = lib.mkOption { type = lib.types.attrsOf lib.types.attrs; default = { }; };
          smind.hm.dev.llm.assetBundles = lib.mkOption { type = lib.types.listOf lib.types.anything; default = [ ]; };
          home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
          home.username = lib.mkOption { type = lib.types.str; default = "alice"; };
          xdg.stateHome = lib.mkOption { type = lib.types.str; default = "/home/alice/.local/state"; };
          xdg.configFile = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
          systemd.user.services = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        };
        config = {
          smind.hm.dev.llm.${service} = {
            enable = enabled;
            url = "https://${service}.example.test";
            tokenFile = "/not-readable/${service}.token";
          } // lib.optionalAttrs (service == "haystack") { activityProjectId = "test-activity"; };
          programs.mcp.servers.unrelated.command = "/bin/false";
        };
      })
    ];
  };
  chronicle = evaluate "chronicle" chronicleModule true;
  haystack = evaluate "haystack" haystackModule true;
  chronicleDisabled = evaluate "chronicle" chronicleModule false;
  haystackDisabled = evaluate "haystack" haystackModule false;
  cli = service: module: lib.findFirst (package: lib.getName package == "${service}-cli-configured") null module.config.home.packages;
  chronicleCLI = cli "chronicle" chronicle;
  haystackCLI = cli "haystack" haystack;
in
assert lib.assertMsg (chronicleCLI != null) "Chronicle configured CLI is not installed";
assert lib.assertMsg (haystackCLI != null) "Haystack configured CLI is not installed";
assert lib.all (module: lib.all (assertion: assertion.assertion) module.config.assertions) [ chronicle haystack chronicleDisabled haystackDisabled ];
assert chronicleDisabled.config.home.packages == [ ];
assert haystackDisabled.config.home.packages == [ ];
assert !(chronicleDisabled.config.programs.mcp.servers ? chronicle);
assert !(haystackDisabled.config.programs.mcp.servers ? haystack);
assert lib.all (module: module.config.programs.mcp.servers.unrelated.command == "/bin/false") [ chronicle haystack chronicleDisabled haystackDisabled ];
pkgs.runCommand "service-cli-hm-test" { nativeBuildInputs = [ pkgs.python3 ]; } ''
  mkdir "$out"
  export CHRONICLE_CLI=${chronicleCLI}/bin/chronicle
  export HAYSTACK_CLI=${haystackCLI}/bin/haystack
  export RECEIPT="$out/receipt.json"
  python3 - <<'PY'
  import json, os, subprocess
  from pathlib import Path
  cases = []
  for service in ('chronicle', 'haystack'):
      prefix = service.upper()
      executable = os.environ[prefix + '_CLI']
      def run(arguments, values):
          environment = {'PATH': os.environ['PATH'], 'HOME': os.environ['TMPDIR']}
          environment.update({prefix + '_' + key: value for key, value in values.items()})
          result = subprocess.run([executable, *arguments], env=environment, text=True,
                                  capture_output=True, timeout=10)
          assert result.returncode == 0, result.stderr
          assert result.stderr == "", result.stderr
          return result.stdout
      assert run(['--help'], {}) == service + ' help\n'
      cases.append(service + ':help-with-unreadable-default-token')
      default = {'URL': 'https://' + service + '.example.test', 'TOKEN': None,
                 'TOKEN_FILE': '/not-readable/' + service + '.token'}
      assert json.loads(run([], {})) == default
      cases.append(service + ':configured-fallback')
      assert json.loads(run([], {'TOKEN': 'synthetic-literal'})) == {
          **default, 'TOKEN': 'synthetic-literal', 'TOKEN_FILE': None}
      cases.append(service + ':runtime-literal-overrides-file-fallback')
      assert json.loads(run([], {'TOKEN_FILE': '/runtime/explicit.token'})) == {
          **default, 'TOKEN_FILE': '/runtime/explicit.token'}
      cases.append(service + ':runtime-file-overrides-file-fallback')
      assert json.loads(run([], {'TOKEN': 'synthetic-literal', 'TOKEN_FILE': '/runtime/explicit.token'})) == {
          **default, 'TOKEN': 'synthetic-literal', 'TOKEN_FILE': '/runtime/explicit.token'}
      cases.append(service + ':ambiguous-runtime-pair-left-for-client-validation')
      assert json.loads(run([], {'URL': 'https://runtime.example.test'})) == {
          **default, 'URL': 'https://runtime.example.test'}
      cases.append(service + ':runtime-url-overrides-configured-default')
  assert len(cases) == 12 and len(cases) == len(set(cases))
  Path(os.environ['RECEIPT']).write_text(json.dumps({
      'tests': cases, 'runtimeCases': len(cases), 'moduleCases': 4,
      'failures': 0, 'errors': 0, 'skips': 0,
      'scope': 'Configured wrapper precedence/laziness with controlled underlying CLI, enabled/disabled module composition; not actual client/server behavior.'
  }, indent=2) + '\n')
  PY
''
