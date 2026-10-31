# Behavioral-Active Blackbox-Group; Specified extraction/deployment contract.
# Standalone HM boundary: no downstream hosts, secrets, cfg-meta or agenix.
{
  pkgs,
  inputs,
  agenticServicesModule ? import ../hm/agentic-services-server.nix { inherit inputs; },
}:
let
  inherit (pkgs) lib;
  baseline = builtins.fromJSON (builtins.readFile ./fixtures/agentic-services-legacy.json);
  eval =
    modules:
    lib.evalModules {
      specialArgs = { inherit pkgs; };
      modules = [
        agenticServicesModule
        ./user-services-stub.nix
      ]
      ++ modules;
    };
  legacy = eval [ ./agentic-services-legacy-config.nix ];
  cfg = legacy.config;
  artifacts = cfg.lib.ponygirls.agenticServices;
  units = cfg.systemd.user.services;
  extend =
    settings:
    (legacy.extendModules { modules = [ { smind.hm.services.agentic = settings; } ]; }).config;
  allAssertions = config: lib.all (a: a.assertion) config.assertions;
  fails = settings: !allAssertions (extend settings);
  # Inputs deliberately absent: disabled module must not resolve package defaults.
  inert =
    (lib.evalModules {
      specialArgs = { inherit pkgs; };
      modules = [
        (import ../hm/agentic-services-server.nix { inputs = { }; })
        ./user-services-stub.nix
      ];
    }).config;
  disabled = extend { enable = lib.mkForce false; };
  retired = extend {
    haystack = {
      enable = lib.mkForce false;
      agentTokenFile = lib.mkForce null;
    };
    manure = {
      enable = lib.mkForce false;
      agentTokenFile = lib.mkForce null;
    };
  };
  combos = lib.cartesianProduct {
    haystack = [
      true
      false
    ];
    manure = [
      true
      false
    ];
  };
  testCombo =
    flags:
    let
      c = extend {
        haystack = {
          enable = lib.mkForce flags.haystack;
          agentTokenFile = lib.mkForce (if flags.haystack then "/run/secrets/haystack" else null);
        };
        manure = {
          enable = lib.mkForce flags.manure;
          agentTokenFile = lib.mkForce (if flags.manure then "/run/secrets/manure" else null);
        };
      };
      names = builtins.attrNames c.systemd.user.services;
      proxy = c.lib.ponygirls.agenticServices.proxyConfig.text;
      setup = c.systemd.user.services.ivm-services-setup.Service.ExecStart.text;
    in
    assert allAssertions c;
    assert builtins.elem "ivm-haystack" names == flags.haystack;
    assert builtins.elem "ivm-postgres" names == flags.haystack;
    assert builtins.elem "ivm-haystack-backup" names == flags.haystack;
    assert (c.systemd.user.timers ? ivm-haystack-backup) == flags.haystack;
    assert builtins.elem "ivm-manure" names == flags.manure;
    assert lib.hasInfix ":8445" proxy == flags.haystack;
    assert lib.hasInfix ":8446" proxy == flags.manure;
    assert lib.hasInfix "--haystack-agent-file" setup == flags.haystack;
    assert lib.hasInfix "--manure-agent-file" setup == flags.manure;
    assert lib.hasInfix "postgres-socket" setup == flags.haystack;
    assert lib.hasInfix "redis-password"
      c.systemd.user.services.ivm-crawl4ai-redis.Service.ExecStart.text;
    true;
  http = extend { host.scheme = lib.mkForce "http"; };
  moved = extend {
    unitPrefix = lib.mkForce "custom";
    stateDirectory = lib.mkForce "/srv/private-agent-state";
    ports.crawl4ai = 9444;
    crawl4ai = {
      port = 21235;
      redisPort = 26379;
    };
    haystack.port = 57328;
    manure.port = 57329;
    searxng.port = 9888;
    setupDependencies = lib.mkForce [ "custom-secret-setup.service" ];
    static.root = "/srv/private-static";
    proxy = {
      extraHttpConfig = "limit_req_zone $binary_remote_addr zone=extra_login:1m rate=5r/m;";
      extraServerConfig = "server { listen 127.0.0.1:9448; server_name extra.example.test; location / { return 204; } }";
    };
  };
  customSearx = extend {
    searxng.settings = {
      server = {
        method = "GET";
        secret_key = "must-not-be-rendered";
        limiter = true;
        image_proxy = true;
      };
      search.formats = [
        "html"
        "json"
      ];
    };
  };
  noStatic = extend {
    static = {
      enable = lib.mkForce false;
      publishTokenFile = lib.mkForce null;
    };
  };
  # Snapshot text carries references only as text; no service package builds.
  snapshot = pkgs.writeText "agentic-services-current.json" (
    builtins.unsafeDiscardStringContext (
      builtins.toJSON {
        proxy = artifacts.proxyConfig.text;
        haystackAuth = artifacts.haystackAuth.value;
        manureConfig = artifacts.manureConfig.value;
        units = builtins.attrNames units;
        timers = builtins.attrNames cfg.systemd.user.timers;
        setup = units.ivm-services-setup.Service.ExecStart.text;
        crawl = units.ivm-crawl4ai.Service.ExecStart.text;
        postgres = units.ivm-postgres.Service.ExecStart.text;
      }
    )
  );
in
assert allAssertions cfg;
assert inert.systemd.user.services == { };
assert inert.systemd.user.timers == { };
assert inert.home.packages == [ ];
assert inert.fonts.fontconfig.enable == false;
assert inert.lib == { };
assert inert.xdg.configFile == { };
assert inert.assertions == [ ];
assert disabled.systemd.user.services == { };
assert disabled.systemd.user.timers == { };
assert disabled.lib == { };
assert disabled.home.packages == [ ];
assert builtins.attrNames units == baseline.units;
assert builtins.attrNames cfg.systemd.user.timers == baseline.timers;
assert builtins.all testCombo combos;
assert allAssertions retired;
assert
  builtins.attrNames retired.systemd.user.services == [
    "ivm-crawl4ai"
    "ivm-crawl4ai-redis"
    "ivm-searxng"
    "ivm-services-proxy"
    "ivm-services-setup"
  ];
assert units.ivm-services-setup.Unit.After == [ "agenix.service" ];
assert units.ivm-services-setup.Unit.Wants == [ "agenix.service" ];
assert !(units.ivm-services-setup.Unit ? Requires);
assert !(units.ivm-crawl4ai.Unit ? Requires);
assert
  units.ivm-crawl4ai.Unit.After == [
    "ivm-services-setup.service"
    "agenix.service"
    "ivm-crawl4ai-redis.service"
  ];
assert units.ivm-haystack-database.Unit.Requires == [ "ivm-postgres.service" ];
assert units.ivm-postgres.Service.KillSignal == "SIGINT";
assert units.ivm-postgres.Service.TimeoutStopSec == 120;
assert units.ivm-services-setup.Service.UMask == "0077";
assert units.ivm-crawl4ai.Service.NoNewPrivileges;
assert cfg.systemd.user.timers.ivm-haystack-backup.Timer.OnCalendar == "daily";
assert cfg.systemd.user.timers.ivm-haystack-backup.Timer.Persistent;
assert artifacts.haystackAuth.value == baseline.haystackAuth;
assert artifacts.manureConfig.value == baseline.manureConfig;
assert http.lib.ponygirls.agenticServices.haystackAuth.value.cookieSecure == false;
assert builtins.elem "http://services.example.test:8445"
  http.lib.ponygirls.agenticServices.haystackAuth.value.insecureHttpOrigins;
assert !(lib.hasInfix " ssl;" http.lib.ponygirls.agenticServices.proxyConfig.text);
assert allAssertions moved;
assert moved.systemd.user.services ? custom-crawl4ai;
assert !(moved.systemd.user.services ? ivm-crawl4ai);
assert
  moved.systemd.user.services.custom-services-setup.Unit.Wants == [ "custom-secret-setup.service" ];
assert lib.hasInfix "listen 100.64.0.2:9444 ssl;"
  moved.lib.ponygirls.agenticServices.proxyConfig.text;
assert lib.hasInfix "proxy_pass http://127.0.0.1:21235;"
  moved.lib.ponygirls.agenticServices.proxyConfig.text;
assert lib.hasInfix "proxy_pass http://127.0.0.1:57328;"
  moved.lib.ponygirls.agenticServices.proxyConfig.text;
assert lib.hasInfix "proxy_pass http://127.0.0.1:57329;"
  moved.lib.ponygirls.agenticServices.proxyConfig.text;
assert lib.hasInfix "proxy_pass http://127.0.0.1:9888;"
  moved.lib.ponygirls.agenticServices.proxyConfig.text;
assert lib.hasInfix "zone=extra_login:1m" moved.lib.ponygirls.agenticServices.proxyConfig.text;
assert lib.hasInfix "listen 127.0.0.1:9448;" moved.lib.ponygirls.agenticServices.proxyConfig.text;
assert lib.hasInfix "root /srv/private-static;"
  moved.lib.ponygirls.agenticServices.proxyConfig.text;
assert lib.hasInfix "REDIS_PORT=26379"
  moved.systemd.user.services.custom-crawl4ai.Service.ExecStart.text;
assert lib.hasInfix "/srv/private-agent-state/credentials"
  moved.systemd.user.services.custom-services-setup.Service.ExecStart.text;
assert customSearx.lib.ponygirls.agenticServices.searxSettings.value.use_default_settings;
assert
  customSearx.lib.ponygirls.agenticServices.searxSettings.value.search.formats == [
    "html"
    "json"
  ];
assert
  customSearx.lib.ponygirls.agenticServices.searxSettings.value.server == {
    bind_address = "127.0.0.1";
    port = 8888;
    secret_key = "__AGENTIC_SERVICES_SEARX_SECRET__";
    limiter = false;
    image_proxy = false;
    method = "GET";
  };
assert lib.hasInfix "settings.yml"
  customSearx.systemd.user.services.ivm-searxng.Service.ExecStart.text;
assert noStatic.lib.ponygirls.agenticServices.proxyConfig.text != "";
assert !(lib.hasInfix ":8447" noStatic.lib.ponygirls.agenticServices.proxyConfig.text);
assert
  !(lib.hasInfix "static.htpasswd" noStatic.systemd.user.services.ivm-services-setup.Service.ExecStart.text);
assert fails { stateDirectory = lib.mkForce "relative"; };
assert fails { stateDirectory = lib.mkForce "/nix/store/state"; };
assert fails { crawl4ai.tokenFile = lib.mkForce "/nix/store/token"; };
assert fails { haystack.agentTokenFile = lib.mkForce "relative"; };
assert fails { manure.agentTokenFile = lib.mkForce null; };
assert fails { tls.keyFile = lib.mkForce null; };
assert fails { static.publishTokenFile = lib.mkForce "/nix/store/token"; };
assert fails { crawl4ai.listenAddress = "0.0.0.0"; };
assert fails { haystack.listenAddress = "0.0.0.0"; };
assert fails { manure.listenAddress = "0.0.0.0"; };
assert fails { searxng.listenAddress = "0.0.0.0"; };
pkgs.runCommandLocal "agentic-services-hm-eval"
  {
    nativeBuildInputs = [ pkgs.python3 ];
    haystackAuth = artifacts.haystackAuth;
    manureConfig = artifacts.manureConfig;
  }
  ''
    python3 ${./agentic-services-snapshot-test.py} ${./fixtures/agentic-services-legacy.json} ${snapshot} "$haystackAuth" "$manureConfig"
    touch "$out"
  ''
