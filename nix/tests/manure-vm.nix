# manure NixOS VM test (N1 + N2 + M2, LIVE service on both nodes).
#
# Contained driver (VM boundary MANDATORY): runNixOSTest with pinned
# defaults that share NO host store/dirs/sockets/devices — regular disk
# images only under the lab dir. Legacy testers.nixosTest does NOT accept
# `defaults` and actually shares the host store/xchg/shared; never boot it.
# No TAP/bridge/VDE here (not required); user-mode networking only.
#
# No skip paths: this derivation always runs the full two-node test
# once the server sync exists (it does). Nodes:
#   edge   — production-like TLS proxy (self-signed test cert baked at
#            activation, test-only): custom dataDir, real LoadCredential
#            digests through the owned launcher, Host-intact ($http_host)
#            proxying, HTTP→HTTPS redirect, full handoff e2e, R5 body-bound
#            probes and R6 log canaries through nginx.
#   strict — loopbackDev=false with trustedProxies=[] (direct backend):
#            the untrusted-peer X-Forwarded-Proto hostile-header case.
{ pkgs, nixpkgs, manureModule, manureHmModule, yoloHmModule, toolsHmModule }:
let
  lib = nixpkgs.lib;
  # Test-only bearer ("A"*43) + its digest. Fake, generated at eval;
  # never a real secret.
  testToken = lib.concatStrings (lib.genList (_: "A") 43);
  testDigest = builtins.hashString "sha256" testToken;

  mkUser = {
    w-agent = {
      type = "agent";
      tokens.default.tokenHashFile = "/etc/manure-test/token.sha256";
    };
  };

  common = {
    system.stateVersion = "26.11";
    environment.systemPackages = [
      pkgs.curl
      pkgs.jq
      pkgs.python3
      # REAL CLI under test (EXACT same package derivation the service runs).
      (pkgs.callPackage ../pkg/manure/package.nix { })
      # Test-only LLM stand-in (see HM block): drops yolo-injected
      # --append-system-prompt pairs, execs the rest (the REAL CLI).
      hmStubPi
      # REAL generated home profile (whole hm.config.home.path: yolo
      # wrapper + bubblewrap + CLI exactly as home-manager composes them —
      # never a hand-picked subset that could skew from the adapter under
      # test).
      hmEval.home.path
    ];
    environment.etc."manure-test/token.sha256".text = testDigest + "\n";
    # Harness inputs consumed INSIDE sandboxes (token bind, ad-hoc guard
    # bind) live OUTSIDE /etc as regular files: bwrap refuses symlink
    # destinations (all of /etc on NixOS). Pure reads (guardlib, probe,
    # installed-shells via PYTHONPATH, digest, cert) stay in /etc.
    # The token is owner-writable 0600 BY DESIGN: the same-file writable
    # control (O_WRONLY open+close, bytes unchanged) must succeed outside
    # the sandbox so the in-sandbox denial attributes solely to the
    # contributed RO mount (errno retained there), never to file mode.
    system.activationScripts.manureTestHarness.text = ''
      mkdir -p /srv/manure-test
      printf '%s' '${testToken}' > /srv/manure-test/token.raw
      chmod 600 /srv/manure-test/token.raw
      cat > /srv/manure-test/hm-guard.sh <<'GUARDEOF'
${hmGuard.command}
GUARDEOF
      chmod 444 /srv/manure-test/hm-guard.sh
    '';
    # M2 installed-shells probe (guest-run on edge; see ./manure-installed-shells.py).
    environment.etc."manure-test/installed-shells.py".source = ./manure-installed-shells.py;
    # Guard/guardlib/probe delivery (same pattern as installed-shells.py —
    # no shell-quoting layers for file contents). The host hook runs inside
    # the REAL adapter (yolo pi runs host pre-start hooks), so it is NOT
    # delivered separately: direct execution here would duplicate, not prove.
    environment.etc."manure-test/manure_guardlib.py".source = ./manure_guardlib.py;
    environment.etc."manure-test/manure-privacy-check.py".source = ./manure-privacy-check.py;
  };

  # HM adapter acceptance: REAL homeManagerConfiguration from the PINNED
  # home-manager source resolved through this flake's own nixpkgs
  # (`pkgs.home-manager.src`, rev pinned by assertion below) — never a new
  # scaffold, never invented leaf options. Composed with the REAL tools,
  # manure and yolo HM modules (podman aggregator unneeded: yolo defines
  # its own podman socket options); only home identity/state come from the
  # test block. Version discipline: repo pins nixos-unstable and HM's
  # unstable channel is its designed counterpart, so the pinned-graph
  # pairing is the compatible choice; the rev assertion forces explicit
  # re-review on any nixpkgs bump instead of silent skew.
  hmSrc = pkgs.home-manager.src;
  hmLib = import "${hmSrc}/lib" { inherit (nixpkgs) lib; };
  hmEvalPkgs = import nixpkgs { system = "x86_64-linux"; };
  hm = hmLib.homeManagerConfiguration {
    pkgs = hmEvalPkgs;
    # Explicit full profile (minimal=false keeps programs.mcp/assertions;
    # check=true keeps the framework's own option validation loud).
    check = true;
    minimal = false;
    modules = [
      toolsHmModule
      manureHmModule
      yoloHmModule
      ({ ... }: {
        home.username = "root";
        home.homeDirectory = "/root";
        home.stateVersion = "26.11";
        smind.hm.dev.llm.enable = true;
        smind.hm.dev.llm.manure = {
          enable = true;
          url = "https://api.example.test";
          tokenFile = "/srv/manure-test/token.raw";
          userId = "w-agent";
          tokenId = "default";
          cacheDir = "/srv/manure-hm-cache";
        };
        # Test-CA trust through REAL adapter options (same mechanism as
        # every other session var/bind: evaluated, baked, mounted). No
        # forwarded-allowlist shell exports for trust material.
        smind.hm.dev.llm.yolo.sessionVariables.SSL_CERT_FILE = "/srv/manure-test/cert.crt";
        smind.hm.dev.llm.yolo.extraReadOnlyPaths = [ "/srv/manure-test/cert.crt" ];
      })
    ];
  };
  hmEval = hm.config;
  hmHook = builtins.head (builtins.filter (h: h.tags == [ "manure-cache" ]) hmEval.smind.hm.dev.llm.yolo.hooks.pre-start.host);
  hmGuard = builtins.head (builtins.filter (h: h.tags == [ "manure-cache" ]) hmEval.smind.hm.dev.llm.yolo.hooks.pre-start.sandbox);
  # Outside-default-writables choice pinned: an HM cache under HOME/.cache
  # or the driver cwd would NOT exercise the persistent-bind surface.
  hmCacheDir = toString hmEval.smind.hm.dev.llm.manure.cacheDir;
  hmBindsRw = hmEval.smind.hm.dev.llm.yolo.extraReadWritePaths;
  hmBindsRo = hmEval.smind.hm.dev.llm.yolo.extraReadOnlyPaths;
  hmSession = hmEval.smind.hm.dev.llm.yolo.sessionVariables;
  # Adapter-completeness pins on the evaluated package list (the profile
  # itself is installed whole above; these names must be present).
  hmYoloDrv = builtins.head (builtins.filter (drv: (drv.name or "") == "yolo") hmEval.home.packages);
  hmStubPi = pkgs.writeShellScriptBin "pi" ''
    # Test-only LLM stand-in behind the REAL yolo adapter (see HM block):
    # drops yolo-injected --append-system-prompt pairs, execs the rest.
    while [ $# -gt 0 ] && [ "$1" = "--append-system-prompt" ]; do shift 2; done
    if [ $# -eq 0 ]; then echo 'stub-pi: no command after prompt strip' >&2; exit 127; fi
    exec "$@"
  '';
in
assert builtins.length (builtins.filter (h: h.tags == [ "manure-cache" ]) hmEval.smind.hm.dev.llm.yolo.hooks.pre-start.host) == 1;
assert builtins.length (builtins.filter (h: h.tags == [ "manure-cache" ]) hmEval.smind.hm.dev.llm.yolo.hooks.pre-start.sandbox) == 1;
assert hmCacheDir == "/srv/manure-hm-cache";
assert hmBindsRw == [ "/srv/manure-hm-cache" ];
# Merge order is evaluated truth (test-block cert sorts before the module
# token here); order pins mount precedence, so any change fails loudly.
assert hmBindsRo == [ "/srv/manure-test/cert.crt" "/srv/manure-test/token.raw" ];
assert hmSession.MANURE_URL == "https://api.example.test";
assert hmSession.MANURE_TOKEN_FILE == "/srv/manure-test/token.raw";
assert hmSession.MANURE_CACHE_DIR == "/srv/manure-hm-cache";
assert hmSession.SSL_CERT_FILE == "/srv/manure-test/cert.crt";
assert lib.hasInfix "mkdir -p" hmHook.command;
assert lib.hasInfix "exit 1" hmGuard.command;
assert lib.any (drv: (drv.name or "") == "yolo") hmEval.home.packages;
assert builtins.length (builtins.filter (drv: (drv.name or "") == "yolo") hmEval.home.packages) == 1;
assert lib.any (drv: lib.hasPrefix "bubblewrap" (drv.name or "")) hmEval.home.packages;
assert lib.any (drv: (drv.pname or "") == "manure") hmEval.home.packages;
assert hmSession.MANURE_CACHE_DIR == hmCacheDir;
assert hmSrc.rev == "7834e82588860aaf780cec1366524456a70898d7";
(pkgs.testers.runNixOSTest {
  name = "manure-vm";
  defaults = { lib, ... }: {
    virtualisation.useNixStoreImage = true;
    virtualisation.mountHostNixStore = false;
    virtualisation.useHostCerts = false;
    virtualisation.sharedDirectories = lib.mkForce { };
    virtualisation.vlans = lib.mkForce [ ];
    virtualisation.interfaces = lib.mkForce { };
  };
  sshBackdoor.enable = false;
  qemu.forceAccel = true;
  nodes = {
    edge = { config, lib, ... }: {
      imports = [ common manureModule ];
      networking.hosts."127.0.0.1" = [ "api.example.test" ];
      # Test-only self-signed cert (activation-time, before nginx) in the
      # regular harness dir (the adapter bind-mounts it read-only; /etc
      # symlink destinations are unmountable). World-readable by design:
      # throwaway test key, and the nginx pre-start + workers are not
      # root / the service user.
      system.activationScripts.manureTestCert.text = ''
        mkdir -p /srv/manure-test
        ${pkgs.openssl}/bin/openssl req -x509 -newkey rsa:2048 -nodes \
          -keyout /srv/manure-test/cert.key -out /srv/manure-test/cert.crt \
          -days 2 -subj '/CN=api.example.test' \
          -addext 'subjectAltName=DNS:api.example.test,DNS:*.c.example.test'
        chmod 644 /srv/manure-test/cert.crt /srv/manure-test/cert.key
      '';
      smind.services.manure = {
        enable = true;
        users = mkUser;
        apiOrigin = "https://api.example.test";
        contentSuffix = "c.example.test";
        dataDir = "/srv/manure-data";
        proxy.acmeHost = "api.example.test";
      };
      # Explicit test cert instead of an ACME host (no network/DNS here).
      services.nginx.virtualHosts."api.example.test".useACMEHost = lib.mkForce null;
      services.nginx.virtualHosts."api.example.test".sslCertificate = "/srv/manure-test/cert.crt";
      services.nginx.virtualHosts."api.example.test".sslCertificateKey = "/srv/manure-test/cert.key";
      services.nginx.virtualHosts."content-c.example.test".useACMEHost = lib.mkForce null;
      services.nginx.virtualHosts."content-c.example.test".sslCertificate = "/srv/manure-test/cert.crt";
      services.nginx.virtualHosts."content-c.example.test".sslCertificateKey = "/srv/manure-test/cert.key";
    };
    strict = { ... }: {
      imports = [ common manureModule ];
      smind.services.manure = {
        enable = true;
        users = mkUser;
        apiOrigin = "https://strict.example.test";
        contentSuffix = "s.example.test";
        trustedProxies = [ ];
        proxy.enable = false;
      };
    };
  };
  testScript = ''
    edge.wait_for_unit("manure.service")
    edge.wait_for_open_port(47329)
    strict.wait_for_unit("manure.service")
    strict.wait_for_open_port(47329)
    # Proxy readiness is its own gate (R6/SAN/M2 steps need nginx, not just
    # the backend; wait loudly instead of assuming it from backend health).
    edge.wait_for_unit("nginx.service")
    edge.wait_for_open_port(443)

    # N1: custom storage path owned 0700 by the service user (R2 launcher up).
    edge.succeed("test \"$(stat -c '%a %U %G' /srv/manure-data)\" = '700 manure manure'")
    # N1/M2: unauthenticated health through the TLS proxy (Host-intact).
    edge.succeed(
        "curl -sk https://api.example.test/api/v1/health | grep -q '\"ok\":' || "
        "(echo ---DIAG-health---; curl -skv https://api.example.test/api/v1/health 2>&1 | tail -n 25; "
        "ss -tlnp; systemctl status nginx.service --no-pager | head -n 15; "
        "tail -n 20 /var/log/nginx/error.log; false)")
    # Redirect server answers 301 and stays on the sanitized log.
    edge.succeed("curl -s -o /dev/null -w '%{http_code} %{redirect_url}' http://api.example.test/api/v1/health | grep -q '301 https://api.example.test/api/v1/health'")
    # Direct backend without edge headers is refused (production TLS rule):
    # a non-matching Host fails closed as bad-host first, so the
    # tls-required probe sends the valid Host explicitly.
    edge.fail("curl -sf http://127.0.0.1:47329/api/v1/health")
    edge.succeed("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:47329/api/v1/health | grep -q 400")
    edge.succeed("curl -s -o /dev/null -w '%{http_code}' -H 'Host: api.example.test' http://127.0.0.1:47329/api/v1/health | grep -q 403")
    # Edge semantics: X-Forwarded-Proto from the trusted peer is honored
    # (explicit Host: Host validation precedes the TLS check).
    edge.succeed("curl -sf -H 'Host: api.example.test' -H 'X-Forwarded-Proto: https' http://127.0.0.1:47329/api/v1/health | grep -q '\"ok\":'")
    # X-Forwarded-Host never routes: evil value, valid Host still serves.
    edge.succeed("curl -sf -H 'Host: api.example.test' -H 'X-Forwarded-Host: evil.example' -H 'X-Forwarded-Proto: https' http://127.0.0.1:47329/api/v1/health | grep -q '\"ok\":'")
    # strict node: peer is untrusted, so even X-Forwarded-Proto: https fails
    # (explicit Host: Host validation precedes the TLS check).
    strict.succeed("curl -s -o /dev/null -w '%{http_code}' -H 'Host: strict.example.test' -H 'X-Forwarded-Proto: https' http://127.0.0.1:47329/api/v1/health | grep -q 403")
    strict.fail("curl -sf -H 'Host: strict.example.test' -H 'X-Forwarded-Proto: https' http://127.0.0.1:47329/api/v1/health")

    # Authenticated flow through the proxy (real systemd-loaded digest).
    TOKEN = "A" * 43
    edge.succeed(
        "curl -sk -X POST https://api.example.test/api/v1/login "
        "-H 'Origin: https://api.example.test' -H 'Content-Type: application/json' "
        "-d '{\"token\":\"" + TOKEN + "\"}' -c /tmp/jar | grep -q w-agent")
    edge.succeed("curl -sk https://api.example.test/api/v1/whoami -b /tmp/jar | grep -q w-agent")
    edge.succeed(
        "curl -sk -o /dev/null -w '%{http_code}' -X POST https://api.example.test/api/v1/login "
        "-H 'Content-Type: application/json' -d '{\"token\":\"" + TOKEN + "\"}' | grep -q 403")
    edge.succeed(
        "curl -sk -o /dev/null -w '%{http_code}' -X POST https://api.example.test/api/v1/login "
        "-H 'Origin: https://api.example.test' -H 'Content-Type: application/json' -d '{\"token\":\"x\"}' | grep -q 401")

    # Full handoff e2e through the TLS proxy (internal file artifact).
    edge.succeed(
        "printf 'hello manure' > /tmp/index.html && "
        "INIT=$(curl -sk -X POST https://api.example.test/api/v1/artifacts:init "
        "-H \"Authorization: Bearer " + TOKEN + "\" -H 'Content-Type: application/json' "
        "-d '{\"name\":\"vm\",\"kind\":\"dir\",\"visibility\":\"internal\",\"files\":[{\"path\":\"index.html\",\"kind\":\"file\",\"size\":12,\"sha256\":\"'$(sha256sum /tmp/index.html | cut -d\" \" -f1)'\"}]}') && "
        "echo \"$INIT\" > /tmp/init.json && "
        "AID=$(jq -r .artifact_id /tmp/init.json) && echo \"$AID\" > /tmp/aid && "
        "SHA=$(sha256sum /tmp/index.html | cut -d' ' -f1) && "
        "curl -sk -X PUT \"https://api.example.test/api/v1/artifacts/$AID/chunks?path=index.html&offset=0\" "
        "-H \"Authorization: Bearer " + TOKEN + "\" -H 'Content-Type: application/octet-stream' "
        "-H \"X-Chunk-Sha256: $SHA\" --data-binary @/tmp/index.html && "
        "curl -sk -X POST https://api.example.test/api/v1/artifacts/$AID/publish "
        "-H \"Authorization: Bearer " + TOKEN + "\" | grep -q content_url && "
        "GRANT=$(curl -sk -X POST https://api.example.test/api/v1/artifacts/$AID/grants "
        "-H \"Authorization: Bearer " + TOKEN + "\" | jq -r .grant) && "
        "AID2=$(cat /tmp/aid) && "
        "curl -sk --resolve \"$AID2.c.example.test:443:127.0.0.1\" "
        "-X POST \"https://$AID2.c.example.test/__manure/grant\" "
        "-H 'Content-Type: application/json' -H \"Origin: https://api.example.test\" "
        "-d \"{\\\"grant\\\":\\\"$GRANT\\\"}\" -c /tmp/content-jar && "
        "curl -sk --resolve \"$AID2.c.example.test:443:127.0.0.1\" "
        "\"https://$AID2.c.example.test/index.html\" -b /tmp/content-jar | grep -q 'hello manure'")
    # Runtime config (materialized by the launcher) carries resolved
    # credential paths, never digest material.
    edge.succeed("grep -q '/run/credentials/manure.service/manure-hash-w-agent-default' /run/manure/manure-config.json")
    edge.fail("grep -Eq '[0-9a-f]{64}' /run/manure/manure-config.json")

    # R5 through nginx: a manifest larger than chunkBytes (1 MiB) but
    # under maxRequestBodyBytes (4 MiB) is admitted; above 4 MiB → 413.
    edge.succeed(
        "python3 -c \"import json; print(json.dumps({'name':'big','kind':'dir','visibility':'internal','files':[{'path':'f%06d'%i+'x'*790,'kind':'file','size':1,'sha256':'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'} for i in range(2000)]}))\" > /tmp/big.json && "
        "ls -l /tmp/big.json && "
        "test $(stat -c %s /tmp/big.json) -gt 1048576 && "
        "test $(stat -c %s /tmp/big.json) -lt 4194304 && "
        "curl -sk -X POST https://api.example.test/api/v1/artifacts:init "
        "-H \"Authorization: Bearer " + TOKEN + "\" -H 'Content-Type: application/json' "
        "--data-binary @/tmp/big.json | grep -q artifact_id")
    edge.succeed(
        "python3 -c \"import json; print(json.dumps({'name':'huge','kind':'dir','visibility':'internal','files':[{'path':'g%06d'%i+'y'*790,'kind':'file','size':1,'sha256':'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'} for i in range(6000)]}))\" > /tmp/huge.json && "
        "test $(stat -c %s /tmp/huge.json) -gt 4194304 && "
        "test $(curl -sk -o /dev/null -w '%{http_code}' -X POST https://api.example.test/api/v1/artifacts:init "
        "-H \"Authorization: Bearer " + TOKEN + "\" -H 'Content-Type: application/json' "
        "--data-binary @/tmp/huge.json) = 413")

    # Host authority preservation ($http_host value via map, not $host): explicit
    # default port passes, wrong port fails closed (stripping would let
    # :9999 through as no-port and incorrectly pass), wrong host fails.
    # Verified repro: $host strips api.example:PORT -> api.example.
    edge.succeed("curl -sk -o /dev/null -w '%{http_code}' -H 'Host: api.example.test:443' https://api.example.test/api/v1/health | grep -q 200")
    edge.succeed("curl -sk -o /dev/null -w '%{http_code}' -H 'Host: api.example.test:9999' https://api.example.test/api/v1/health | grep -q 400")
    edge.succeed("curl -sk -o /dev/null -w '%{http_code}' -H 'Host: evil.example' https://api.example.test/api/v1/health | grep -q 400")

    # R6 canaries: query secrets + raw request headers must not land in
    # the sanitized access log (proxied AND redirect traffic). Judged by the
    # SHARED privacy probe (same guard code as host checks and fixtures);
    # its --selftest below proves the gates live in the guest first.
    # Failure channels covered: access file (sanitized, must be clean),
    # API-location error channel (intentionally /dev/null — verified via
    # nginx -T dump below, never a persistent file for this location),
    # systemd journal for nginx+manure (must be clean — location errors go
    # to /dev/null, not the journal). Never claim all-log privacy from
    # access-only/single-502: all three channels are checked independently.
    # Steps are split per-link (not one && mega-chain) so the driver names
    # the exact failing link instead of hiding it (prelim lesson).
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --selftest")
    # Offset-windowed evidence: each canary below is correlated to its own
    # request by access-file byte offsets (transport exit asserted in shell
    # — curl's own status lives there — exact codes via the SHARED status
    # guard through --status-file; a bare curl|grep would bless curl-000).
    edge.succeed("stat -c %s /var/log/nginx/manure-access.log > /tmp/off-canary")
    edge.succeed("code=$(curl -sk -o /dev/null -w '%{http_code}' 'https://api.example.test/api/v1/nope?grant=CANARY_QUERY_7f3a&password=CANARY_PW_9b1c' -H 'Referer: https://x.example/?q=CANARY_REFERER_4d2e' -A 'CANARY_UA_8c5f'); rc=$?; echo \"$code\" > /tmp/code-canary-api; test $rc -eq 0")
    edge.succeed("code=$(curl -s -o /dev/null -w '%{http_code}' 'http://api.example.test/api/v1/nope?tok=CANARY_REDIRECT_1a2b'); rc=$?; echo \"$code\" > /tmp/code-canary-rdr; test $rc -eq 0")
    edge.succeed("sleep 1")
    edge.succeed("tail -c +$(($(cat /tmp/off-canary)+1)) /var/log/nginx/manure-access.log > /tmp/canary-window.log")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log /tmp/canary-window.log --absent CANARY_QUERY_7f3a --absent CANARY_PW_9b1c --absent CANARY_REFERER_4d2e --absent CANARY_UA_8c5f --absent CANARY_REDIRECT_1a2b --present-substr 'GET /api/v1/nope ' --present-substr ' 404 ' --present-substr ' 301 ' --status-file /tmp/code-canary-api --expect 404")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log /tmp/canary-window.log --status-file /tmp/code-canary-rdr --expect 301")
    # R6-error failure paths (intentional /dev/null for API location):
    # (a) upstream connection-refused 502 with query: access stays sanitized
    # with 502 retained, location errors discarded (no file), global/journal
    # clean; (b) critical access-log write failure (/dev/full bind): alert
    # would leak query via native format despite crit (verified host repro),
    # so the unsafe channel is intentionally disabled; safe observability
    # preserved via client status + backend allowlisted app logs + global
    # errors for non-API contexts (gate liveness is proven once by the
    # probe --selftest above, which drives these same functions).
    edge.succeed("$(readlink -f /proc/$(systemctl show -p MainPID --value nginx.service)/exe) -c /etc/nginx/nginx.conf -T > /tmp/nginx-T.log 2> /tmp/nginx-T.err")
    edge.succeed("! grep -q 'manure-error.log' /tmp/nginx-T.log")
    edge.succeed("grep -E '^\\s*error_log' /tmp/nginx-T.log > /tmp/error-channels.log")
    edge.succeed("systemctl stop manure.service")
    edge.succeed("for i in $(seq 1 30); do if curl -sk -o /dev/null -w '%{http_code}' 'https://api.example.test/api/v1/nope?grant=CANARY_ERR502_5a6b' | grep -q 502; then break; fi; sleep 0.2; done")
    edge.succeed("curl -sk 'https://api.example.test/api/v1/nope?grant=CANARY_ERR502_5a6b' -o /dev/null -w '%{http_code}' | grep -q 502")
    edge.succeed("sleep 1")
    edge.succeed("journalctl -u nginx --no-pager > /tmp/j502-nginx.log")
    edge.succeed("journalctl -u manure --no-pager > /tmp/j502-manure.log")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log /var/log/nginx/manure-access.log --log /tmp/j502-nginx.log --log /tmp/j502-manure.log --absent CANARY_ERR502_5a6b --present-substr 'GET /api/v1/nope '")
    edge.succeed("systemctl start manure.service")
    edge.succeed("for i in $(seq 1 50); do if out=$(curl -sk https://api.example.test/api/v1/health); then echo \"$out\" | grep -q '\"ok\":' && break; fi; sleep 0.2; done")
    edge.succeed("out=$(curl -sk https://api.example.test/api/v1/health); rc=$?; echo \"$out\" > /tmp/health.json; test $rc -eq 0 && grep -q '\"ok\":' /tmp/health.json")
    # R6-error critical: access-log disk-write failure (/dev/full bind).
    # Alert-level native format would leak query despite crit (host repro),
    # so location errors go to /dev/null (intentional); safe observability
    # via client status + app logs + global non-API errors. Restores access
    # afterwards and re-verifies health (no persistent unsafe channel).
    edge.succeed("cp /var/log/nginx/manure-access.log /tmp/access-backup.log")
    edge.succeed("stat -c %s /var/log/nginx/manure-access.log > /tmp/off-premount")
    edge.succeed("mount --bind /dev/full /var/log/nginx/manure-access.log")
    edge.succeed("mount | grep -q 'on /var/log/nginx/manure-access.log '")
    edge.succeed("systemctl show -p MainPID --value nginx.service > /tmp/nginx-pid-before")
    edge.succeed("systemctl restart nginx")
    edge.succeed("sleep 2")
    edge.succeed("test \"$(systemctl show -p MainPID --value nginx.service)\" != \"$(cat /tmp/nginx-pid-before)\"")
    # Active worker FD identity (not just the displayed name): the worker's
    # access-log FD must resolve to /dev/full itself.
    edge.succeed("found=0; full=$(stat -Lc '%d:%i' /dev/full); for d in /proc/[0-9]*; do if grep -q 'nginx: worker process' \"$d/cmdline\" 2>/dev/null; then for fd in \"$d\"/fd/*; do if test \"$(stat -Lc '%d:%i' \"$fd\" 2>/dev/null)\" = \"$full\"; then found=1; fi; done; fi; done; test $found -eq 1")
    # Demonstrate the intended ENOSPC cause directly on the mounted path.
    edge.succeed("if python3 -c \"f=open('/var/log/nginx/manure-access.log','a'); f.write('x'); f.flush()\" 2>/tmp/enospc.err; then echo 'UNEXPECTED-WRITE-SUCCESS' >&2; exit 1; fi; grep -q 'No space left' /tmp/enospc.err")
    edge.succeed("journalctl --show-cursor -n0 -u nginx --no-pager | tail -1 | sed 's/^-- cursor: //' > /tmp/cur-crit")
    edge.succeed("test -s /tmp/cur-crit")
    edge.succeed("code=$(curl -sk -o /dev/null -w '%{http_code}' 'https://api.example.test/api/v1/nope?grant=CANARY_CRITFULL_CC44'); rc=$?; echo \"$code\" > /tmp/code-crit-api; test $rc -eq 0")
    edge.succeed("code=$(curl -s -o /dev/null -D /tmp/rdr-crit.hdrs -w '%{http_code}' 'http://api.example.test/api/v1/nope?tok=CANARY_RDRCRIT_EE66'); rc=$?; echo \"$code\" > /tmp/code-crit-rdr; test $rc -eq 0")
    edge.succeed("grep -q '^Location: ' /tmp/rdr-crit.hdrs")
    edge.succeed("sleep 1")
    edge.succeed("journalctl --after-cursor=\"$(cat /tmp/cur-crit)\" -u nginx --no-pager > /tmp/jcrit-nginx.log")
    edge.succeed("journalctl --after-cursor=\"$(cat /tmp/cur-crit)\" -u manure --no-pager > /tmp/jcrit-manure.log")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log /tmp/jcrit-nginx.log --log /tmp/jcrit-manure.log --absent CANARY_CRITFULL_CC44 --absent CANARY_RDRCRIT_EE66 --present-substr 'GET not-found -> 404' --status-file /tmp/code-crit-api --expect 404")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log /tmp/jcrit-nginx.log --log /tmp/jcrit-manure.log --status-file /tmp/code-crit-rdr --expect 301")
    # All four Manure contexts (2 API locations + 2 redirects) disable the
    # unsafe native error channel; global diagnostics stay untouched.
    edge.succeed("test $(grep -c 'error_log /dev/null;' /tmp/nginx-T.log) -eq 4")
    # Every persistent file error channel configured on this host must be
    # free of every canary so far (independent per-channel check; journal
    # channels are covered by the windowed probes above).
    edge.succeed("for f in $(awk '$1 == \"error_log\" { gsub(/;/, \"\", $2); print $2 }' /tmp/nginx-T.log | sort -u); do case \"$f\" in /*) ;; *) continue;; esac; if test \"$f\" = \"/dev/null\"; then continue; fi; PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log \"$f\" --absent CANARY_QUERY_7f3a --absent CANARY_PW_9b1c --absent CANARY_REFERER_4d2e --absent CANARY_UA_8c5f --absent CANARY_REDIRECT_1a2b --absent CANARY_ERR502_5a6b --absent CANARY_CRITFULL_CC44 --absent CANARY_RDRCRIT_EE66 || exit 1; done")
    edge.succeed("systemctl stop nginx")
    edge.succeed("umount /var/log/nginx/manure-access.log")
    edge.succeed("systemctl start nginx")
    edge.succeed("sleep 2")
    # Nothing persisted during the fixture: size identical to premount, and
    # the channel serves fresh sanitized records again afterwards.
    edge.succeed("test $(stat -c %s /var/log/nginx/manure-access.log) -eq $(cat /tmp/off-premount)")
    edge.succeed("stat -c %s /var/log/nginx/manure-access.log > /tmp/off-restored")
    edge.succeed("out=$(curl -sk https://api.example.test/api/v1/health); rc=$?; echo \"$out\" > /tmp/health-restored.json; test $rc -eq 0 && grep -q '\"ok\":' /tmp/health-restored.json")
    edge.succeed("tail -c +$(($(cat /tmp/off-restored)+1)) /var/log/nginx/manure-access.log > /tmp/restored-window.log")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log /tmp/restored-window.log --absent CANARY_CRITFULL_CC44 --absent CANARY_RDRCRIT_EE66 --present-substr 'GET /api/v1/health ' --present-substr ' 200 '")
    edge.succeed("code=$(curl -sk -o /dev/null -w '%{http_code}' 'https://api.example.test/api/v1/nope?grant=CANARY_POSTRESTORE_DD55'); rc=$?; echo \"$code\" > /tmp/code-postrestore; test $rc -eq 0")
    edge.succeed("sleep 1")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log /var/log/nginx/manure-access.log --absent CANARY_POSTRESTORE_DD55 --present-substr 'GET /api/v1/nope ' --status-file /tmp/code-postrestore --expect 404")
    # M2 installed defaults on the INSTALLED package (parent probe PASS
    # bgt3198d33e85251dea: service-PID cmdline package path, dashboard
    # bytes + Referrer-Policy, external zero-file unlock + 2 JS/CSS bytes;
    # transport-only CERT_NONE — trust/SAN covered by SAN tests below).
    edge.succeed("python3 /etc/manure-test/installed-shells.py")
    # SAN trust (bounded): positive verifies correct SAN with --cacert
    # (no -k) + --resolve (no DNS changes); negative proves wrong SAN
    # fails verification (do NOT claim assurance from -sk/CERT_NONE).
    edge.succeed("out=$(curl --cacert /srv/manure-test/cert.crt --resolve api.example.test:443:127.0.0.1 https://api.example.test/api/v1/health); rc=$?; echo \"$out\" > /tmp/health-san.json; test $rc -eq 0 && grep -q '\"ok\":' /tmp/health-san.json")
    edge.fail("curl --cacert /srv/manure-test/cert.crt --resolve wrong.example:443:127.0.0.1 https://wrong.example/api/v1/health")
    # HM actual (MANDATORY: REAL generated adapter, not a mirror). The yolo
    # WRAPPER package under test is built from the SAME evaluated HM
    # composition as the asserts above (hmEval.home.packages carries
    # bubblewrap + the wrapper derivation whose baked YOLO_PREHOOKS_JSON /
    # YOLO_SANDBOX_HOOKS_JSON / YOLO_SESSION_VARS / binds are the adapter's
    # generated outputs); the guest installs and invokes that REAL `yolo`
    # binary below. Agent modes (pi/claude/codex) are the ONLY dispatch paths
    # that run host pre-start hooks (yolo.sh run_prestart_hooks; `cmd` and
    # `shell` select different hook lists and would NOT exercise absent-cache
    # bootstrap), so the test runs `yolo --disable=codegraph pi -- <cmd>`
    # with a test-only `pi` stand-in on guest PATH that drops yolo's
    # --append-system-prompt pair and execs the rest (standing in for the
    # unused LLM; the REAL manure CLI runs behind the REAL adapter).
    # --disable=codegraph drops yolo's own default index hook (unrelated,
    # keeps the run hermetic); manure-cache hooks stay enabled. SSL trust
    # for the test CA comes from REAL adapter options (sessionVariables +
    # extraReadOnlyPaths in the evaluated composition above, asserted there)
    # and the SAN scope stays bounded (no production claim).
    # Provenance per step: invoked binary attested byte-exact to
    # hm.config.home.path (no PATH shadowing); initially-absent custom
    # cache OUTSIDE default writables; host-hook provisioning THROUGH yolo;
    # ro token bind (read OK, write DENIED, cache-write contrast OK);
    # rw cache bind; fail-closed admission by the ENABLED adapter guard on
    # an occupied cache path (payload sentinel proves non-execution) plus
    # the standalone guard text as complement only; SIGKILL of the actual
    # CLI child (exit 137); retained pre-resume receipts (nonempty AND
    # incomplete) with cursor-bounded chunk-PUT reuse proof; explicit
    # --resume of the SAME artifact ID; byte-equal fetch; credential-free
    # records; cleanup.
    edge.succeed("test ! -e ${hmCacheDir}")
    # The invoked yolo MUST be the evaluated profile's binary (not a shadow
    # on PATH): byte-exact store-path comparison, no name lookup.
    edge.succeed("echo \"yolo-at: $(command -v yolo) -> $(readlink -f $(command -v yolo))\"; echo \"yolo-want: ${hmYoloDrv}/bin/yolo\"; test \"$(readlink -f $(command -v yolo))\" = \"${hmYoloDrv}/bin/yolo\"")
    edge.succeed("mkdir -p /srv/manure-hm-fetch")
    edge.succeed("head -c 33554432 /dev/urandom > /tmp/hm-big.bin")
    # Complementary standalone guard probe (guard TEXT only — NOT adapter
    # admission; the enabled-adapter negative below proves dispatch).
    edge.succeed("rm -rf ${hmCacheDir} /srv/manure-hm-fetch/guard-alone.err")
    edge.succeed("if sh /srv/manure-test/hm-guard.sh > /srv/manure-hm-fetch/guard-alone.log 2> /srv/manure-hm-fetch/guard-alone.err; then echo 'standalone guard did not fail' >&2; exit 1; fi")
    edge.succeed("grep -q 'cache dir unavailable' /srv/manure-hm-fetch/guard-alone.err")
    # Enabled-adapter negative: the manure-cache guard stays ENABLED; a real
    # guest fixture (regular file occupying the cache path) makes host
    # provisioning warn-and-continue and the bind carry a file, so the
    # installed adapter's own sandbox guard must refuse admission BEFORE
    # the payload/CLI executes (sentinel proves non-execution; the hook
    # warning proves the enabled chain engaged rather than skipped).
    edge.succeed("rm -rf ${hmCacheDir} /srv/manure-hm-fetch/guard-disabled.err /srv/manure-hm-fetch/payload-ran && touch ${hmCacheDir}")
    edge.succeed("if yolo --disable=codegraph --ro-bind /srv/manure-test/hm-guard.sh,/srv/manure-test/hm-guard.sh --bind /srv/manure-hm-fetch,/srv/manure-hm-fetch pi -- sh -c 'touch /srv/manure-hm-fetch/payload-ran; manure whoami --json' > /srv/manure-hm-fetch/guard-disabled.log 2> /srv/manure-hm-fetch/guard-disabled.err; then echo 'adapter did NOT fail closed on occupied cache' >&2; exit 1; fi")
    edge.succeed("cat /srv/manure-hm-fetch/guard-disabled.log; cat /srv/manure-hm-fetch/guard-disabled.err; grep -q 'cache dir unavailable' /srv/manure-hm-fetch/guard-disabled.err")
    edge.succeed("grep -q 'warning: yolo pre-start hook failed (continuing)' /srv/manure-hm-fetch/guard-disabled.err")
    edge.succeed("test ! -e /srv/manure-hm-fetch/payload-ran")
    edge.succeed("test -f ${hmCacheDir}")
    edge.succeed("rm -f ${hmCacheDir}")
    # Happy path: host hook provisions, sandbox guard passes inside the
    # entrypoint (a failing guard would abort the launch before the CLI),
    # binds and session env come from the evaluated composition.
    edge.succeed("yolo --disable=codegraph --ro-bind /tmp/hm-big.bin,/tmp/hm-big.bin --bind /srv/manure-hm-fetch,/srv/manure-hm-fetch pi -- manure whoami --json > /srv/manure-hm-fetch/whoami.json")
    edge.succeed("grep -q w-agent /srv/manure-hm-fetch/whoami.json")
    # Token-mount attribution precondition: owner-writable 0600 canonical
    # regular token outside /etc, provably writable outside the sandbox
    # (O_WRONLY open+close, bytes unchanged) so the in-sandbox denial can
    # only come from the contributed RO mount (errno retained there).
    edge.succeed("test $(stat -c %a /srv/manure-test/token.raw) -eq 600")
    edge.succeed("sha256sum /srv/manure-test/token.raw | cut -d' ' -f1 > /tmp/token-pre")
    edge.succeed("python3 -c \"import os; fd=os.open('/srv/manure-test/token.raw',os.O_WRONLY); os.close(fd)\"")
    edge.succeed("test \"$(sha256sum /srv/manure-test/token.raw | cut -d' ' -f1)\" = \"$(cat /tmp/token-pre)\"")
    edge.succeed("yolo --disable=codegraph --ro-bind /tmp/hm-big.bin,/tmp/hm-big.bin --bind /srv/manure-hm-fetch,/srv/manure-hm-fetch --env \"PYTHONPATH=/etc/manure-test\" pi -- python3 -c \"from manure_guardlib import check_token_mount_ro; import os; check_token_mount_ro(os.environ['MANURE_TOKEN_FILE'], os.environ['MANURE_CACHE_DIR']); print('TOKEN-MOUNT-ATTRIBUTION-OK')\" > /srv/manure-hm-fetch/token-denial.log 2>&1")
    edge.succeed("grep -q 'TOKEN-MOUNT-ATTRIBUTION-OK' /srv/manure-hm-fetch/token-denial.log && grep -q 'TOKEN-WRITE-DENIED-OK errno=30 (EROFS)' /srv/manure-hm-fetch/token-denial.log")
    edge.succeed("yolo --disable=codegraph --ro-bind /tmp/hm-big.bin,/tmp/hm-big.bin --bind /srv/manure-hm-fetch,/srv/manure-hm-fetch pi -- sh -c 'manure upload /tmp/hm-big.bin --access internal --json > /srv/manure-hm-fetch/up1.json 2> /srv/manure-hm-fetch/up1.err & echo $! > /tmp/cli.pid; for i in $(seq 1 300); do if ls $MANURE_CACHE_DIR/uploads/ 2>/dev/null | grep -q json; then break; fi; sleep 0.02; done; ls $MANURE_CACHE_DIR/uploads/ 2>/dev/null | grep -q json || exit 31; AID1=$(ls $MANURE_CACHE_DIR/uploads/ | grep json | head -1 | cut -d. -f1); echo $AID1 > /srv/manure-hm-fetch/aid1; TOKEN=$(cat $MANURE_TOKEN_FILE); for i in $(seq 1 300); do RB=$(curl -sk $MANURE_URL/api/v1/artifacts/$AID1/upload-status -H \"Authorization: Bearer $TOKEN\" | jq -r .files[0].received_bytes); if test $RB -gt 0 2>/dev/null; then break; fi; sleep 0.02; done; test $RB -gt 0 || exit 32; for i in $(seq 1 300); do NRKILL=$(curl -sk $MANURE_URL/api/v1/artifacts/$AID1/upload-status -H \"Authorization: Bearer $TOKEN\" | jq -r \".files[0].received_ranges | length\"); if test $NRKILL -gt 0 2>/dev/null; then break; fi; sleep 0.02; done; test $NRKILL -gt 0 || exit 33; kill -9 $(cat /tmp/cli.pid); wait $(cat /tmp/cli.pid); echo killed-exit:$? > /srv/manure-hm-fetch/kill-code; TOT=$(curl -sk $MANURE_URL/api/v1/artifacts/$AID1/upload-status -H \"Authorization: Bearer $TOKEN\" | jq -r .files[0].size); NR=$(curl -sk $MANURE_URL/api/v1/artifacts/$AID1/upload-status -H \"Authorization: Bearer $TOKEN\" | jq -r \".files[0].received_ranges | length\"); echo $RB > /srv/manure-hm-fetch/rb; echo $TOT > /srv/manure-hm-fetch/tot; echo $NR > /srv/manure-hm-fetch/nr; echo ---UP1-ERR-BEGIN---; cat /srv/manure-hm-fetch/up1.err 2>/dev/null; echo ---UP1-ERR-END---; ls $MANURE_CACHE_DIR/uploads/ 2>/dev/null | grep -q json'")
    edge.succeed("grep -q 'killed-exit:137' /srv/manure-hm-fetch/kill-code")
    # Retain the pre-resume receipts (the reuse baseline) before resuming.
    edge.succeed("curl -sk \"https://api.example.test/api/v1/artifacts/$(cat /srv/manure-hm-fetch/aid1)/upload-status\" -H \"Authorization: Bearer $(cat /srv/manure-test/token.raw)\" > /srv/manure-hm-fetch/up-status.json")
    edge.succeed("test $(cat /srv/manure-hm-fetch/rb) -gt 0 && test $(cat /srv/manure-hm-fetch/rb) -lt $(cat /srv/manure-hm-fetch/tot)")
    edge.succeed("test $(cat /srv/manure-hm-fetch/nr) -gt 0")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log ${hmCacheDir}/uploads/*.json --absent $(cat /srv/manure-test/token.raw) --absent $(sha256sum /srv/manure-test/token.raw | cut -d' ' -f1)")
    edge.succeed("journalctl --show-cursor -n0 -u manure --no-pager | tail -1 | sed 's/^-- cursor: //' > /tmp/resume-cursor")
    edge.succeed("test -s /tmp/resume-cursor")
    edge.succeed("yolo --disable=codegraph --ro-bind /tmp/hm-big.bin,/tmp/hm-big.bin --bind /srv/manure-hm-fetch,/srv/manure-hm-fetch pi -- manure upload /tmp/hm-big.bin --access internal --resume $(cat /srv/manure-hm-fetch/aid1) --json > /srv/manure-hm-fetch/up2.json")
    edge.succeed("grep -q artifact_id /srv/manure-hm-fetch/up2.json")
    edge.succeed("jq -r .artifact_id /srv/manure-hm-fetch/up2.json > /srv/manure-hm-fetch/aid2")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --equal-a /srv/manure-hm-fetch/aid1 --equal-b /srv/manure-hm-fetch/aid2")
    edge.succeed("journalctl --after-cursor=\"$(cat /tmp/resume-cursor)\" -u manure --no-pager > /srv/manure-hm-fetch/resume-journal.log")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 -c \"from manure_guardlib import check_resume_reuse; check_resume_reuse('/srv/manure-hm-fetch/up-status.json', '/srv/manure-hm-fetch/resume-journal.log')\"")
    edge.succeed("AID=$(jq -r .artifact_id /srv/manure-hm-fetch/up2.json) && yolo --disable=codegraph --bind /srv/manure-hm-fetch,/srv/manure-hm-fetch pi -- manure fetch $AID /srv/manure-hm-fetch/fetched --json")
    edge.succeed("cmp /tmp/hm-big.bin /srv/manure-hm-fetch/fetched/hm-big.bin")
    edge.succeed("! ls ${hmCacheDir}/uploads/ 2>/dev/null | grep -q .")
  '';
})
