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

  currentClient = pkgs.callPackage ../pkg/manure/client.nix { };
  currentProbe = pkgs.writeShellScriptBin "manure-vm-current-client" ''
    export PYTHONPATH=${currentClient}/lib/python
    exec ${pkgs.python3}/bin/python3 ${./manure-vm-current-client.py} "$@"
  '';

  common = { config, ... }: {
    system.stateVersion = "26.11";
    assertions = [{
      assertion = config.virtualisation.useNixStoreImage
        && config.virtualisation.writableStore
        && config.virtualisation.writableStoreUseTmpfs
        && !config.virtualisation.mountHostNixStore
        && !config.virtualisation.useHostCerts
        && config.virtualisation.sharedDirectories == { }
        && config.fileSystems."/nix/.ro-store".fsType == "erofs"
        && builtins.elem "ro" config.fileSystems."/nix/.ro-store".options
        && config.fileSystems."/nix/.rw-store".fsType == "tmpfs"
        && config.fileSystems."/nix/store".overlay.lowerdir == [ "/nix/.ro-store" ]
        && config.fileSystems."/nix/store".overlay.upperdir == "/nix/.rw-store/upper"
        && config.fileSystems."/nix/store".overlay.workdir == "/nix/.rw-store/work";
      message = "Manure VM requires a guest-only tmpfs overlay over its isolated read-only EROFS store image, never host store/certs/shares";
    }];
    ponygirls.servicePostgres = {
      enable = true;
      databases.manure = { passwordFile = "/etc/manure-test/database-password"; schemas = [ "public" "manure" ]; };
    };
    smind.services.manure.database = {
      jdbcUrl = "jdbc:postgresql://127.0.0.1:15434/manure";
      user = "manure";
      passwordFile = "/etc/manure-test/database-password";
      readinessUnit = "ponygirls-database-manure.service";
    };
    environment.etc."manure-test/database-password".text = "owned-synthetic-vm-database-password\n";
    environment.systemPackages = [
      pkgs.curl
      pkgs.jq
      pkgs.python3
      # REAL CLI under test (same client derivation composed into the server package).
      currentClient
      currentProbe
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
    # M2 attests the actual native PID and installed package, then compares
    # SERVED dashboard/current-codec/unlock bytes (never a source fallback).
    environment.etc."manure-test/installed-package".text = "${config.smind.services.manure.package}\n";
    # Guard/guardlib/probe delivery (same guest-only pattern as currentProbe —
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
  # Use the evaluator's fetcher for the same pinned tree; importing the
  # fixed-output derivation itself would require a build during evaluation.
  hmTree = builtins.fetchTree {
    type = "tarball";
    url = hmSrc.url;
    narHash = hmSrc.outputHash;
  };
  hmLib = import "${hmTree.outPath}/lib" { inherit (nixpkgs) lib; };
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
# The selected credential file is bound dynamically; literals expose no file.
assert hmBindsRo == [ "/srv/manure-test/cert.crt" ];
assert hmSession.MANURE_URL == "https://api.example.test";
assert hmEval.smind.hm.dev.llm.yolo.validatedSessionVariables.MANURE_TOKEN_FILE == "/srv/manure-test/token.raw";
assert hmSession.MANURE_CACHE_DIR == "/srv/manure-hm-cache";
assert hmSession.SSL_CERT_FILE == "/srv/manure-test/cert.crt";
assert lib.hasInfix "mkdir -p" hmHook.command;
assert lib.hasInfix "exit 1" hmGuard.command;
assert lib.any (drv: (drv.name or "") == "yolo") hmEval.home.packages;
assert builtins.length (builtins.filter (drv: (drv.name or "") == "yolo") hmEval.home.packages) == 1;
assert lib.any (drv: lib.hasPrefix "bubblewrap" (drv.name or "")) hmEval.home.packages;
assert lib.any (drv: (drv.name or "") == "manure-client") hmEval.home.packages;
assert hmSession.MANURE_CACHE_DIR == hmCacheDir;
assert hmSrc.rev == "7834e82588860aaf780cec1366524456a70898d7";
(pkgs.testers.runNixOSTest {
  name = "manure-vm";
  defaults = { lib, ... }: {
    virtualisation.useNixStoreImage = true;
    # Same pinned stock register-nix-paths/--load-db prelude as the actual
    # 37d unit-graph VM: plain RO bind fails creating /nix/store/.links even
    # at initial boot. Use its canonical guest tmpfs overlay, as validated
    # by the corrected 468 lifecycle VM; the EROFS image remains read-only.
    virtualisation.writableStore = true;
    virtualisation.writableStoreUseTmpfs = true;
    virtualisation.mountHostNixStore = false;
    virtualisation.useHostCerts = false;
    virtualisation.sharedDirectories = lib.mkForce { };
    virtualisation.vlans = lib.mkForce [ ];
    virtualisation.interfaces = lib.mkForce { };
  };
  sshBackdoor.enable = false;
  # Real QEMU TCG is supported on builders without KVM; never a skip or
  # fabricated host feature. The outer pre-exec attachment auditor still applies.
  requiredFeatures.kvm = false;
  qemu.forceAccel = false;
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
      # Private VM-only observer: literal source file + bounded decimal offset.
      # No raw args, filename query, headers, credentials or body are logged.
      # SAME vhost context as the original access log: never suppress inheritance.
      services.nginx.commonHttpConfig = lib.mkAfter ''
        map "$uri|$arg_path|$arg_offset" $manure_vm_chunk_capture {
          default 0;
          "~^/api/current/artifacts/[0-9a-f]{32}/chunks[|]hm-big[.]bin[|](0|[1-9][0-9]{0,7})$" 1;
        }
        log_format manure_vm_chunk escape=json '{"uri":"$uri","offset":"$arg_offset","status":"$status"}';
      '';
      services.nginx.virtualHosts."api.example.test".extraConfig = lib.mkAfter ''
        access_log /var/log/nginx/manure-vm-chunks.log manure_vm_chunk if=$manure_vm_chunk_capture;
      '';
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

    # Native ownership readiness precedes HTTP probes, not just an open port.
    edge.wait_until_succeeds("manure-vm-current-client ready")
    strict.wait_until_succeeds("manure-vm-current-client ready")
    # N1: custom storage path owned 0700 by the service user (R2 launcher up).
    edge.succeed("test \"$(stat -c '%a %U %G' /srv/manure-data)\" = '700 manure manure'")
    # N1/M2: generated Version replaces the removed GET health route.
    # No current management DTO is handwritten; installed client/codecs own it.
    probe = "manure-vm-current-client "
    edge.succeed(probe + "version")
    # Redirect transport is tested independently of the POST management method.
    edge.succeed("curl -s -o /dev/null -w '%{http_code} %{redirect_url}' http://api.example.test/api/current | grep -q '301 https://api.example.test/api/current'")
    edge.fail(probe + "version --base http://127.0.0.1:47329")
    edge.succeed(probe + "version --base http://127.0.0.1:47329 --expect-status 400 --expect-error BadHost")
    edge.succeed(probe + "version --base http://127.0.0.1:47329 --host api.example.test --expect-status 403 --expect-error TlsRequired")
    edge.succeed(probe + "version --base http://127.0.0.1:47329 --host api.example.test --xfp https")
    edge.succeed(probe + "version --base http://127.0.0.1:47329 --host api.example.test --xfp https --xfh evil.example")
    strict.succeed(probe + "version --base http://127.0.0.1:47329 --host strict.example.test --xfp https --expect-status 403 --expect-error TlsRequired")
    strict.fail(probe + "version --base http://127.0.0.1:47329 --host strict.example.test --xfp https")

    # Current Login/Whoami + secure cookie, missing Origin and invalid token.
    edge.succeed(probe + "auth")
    # Real portable client init/raw-chunk/publish/grant + typed content redemption.
    edge.succeed(probe + "handoff")
    # Runtime config (materialized by the launcher) carries resolved
    # credential paths, never digest material.
    edge.succeed("grep -q '/run/credentials/manure.service/manure-hash-w-agent-default' /run/manure/manure-config.json")
    edge.fail("grep -Eq '[0-9a-f]{64}' /run/manure/manure-config.json")

    # R5: generated current manifest >1MiB and <4MiB admitted; >4MiB413.
    edge.succeed(probe + "body-bounds")
    # Host authority including explicit ports must survive the real proxy.
    edge.succeed(probe + "version --host api.example.test:443")
    edge.succeed(probe + "version --host api.example.test:9999 --expect-status 400 --expect-error BadHost")
    edge.succeed(probe + "version --host evil.example --expect-status 400 --expect-error BadHost")

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
    edge.succeed("code=$(curl -sk -o /dev/null -w '%{http_code}' 'https://api.example.test/api/current/nope?grant=CANARY_QUERY_7f3a&password=CANARY_PW_9b1c' -H 'Referer: https://x.example/?q=CANARY_REFERER_4d2e' -A 'CANARY_UA_8c5f'); rc=$?; echo \"$code\" > /tmp/code-canary-api; test $rc -eq 0")
    edge.succeed("code=$(curl -s -o /dev/null -w '%{http_code}' 'http://api.example.test/api/current/nope?tok=CANARY_REDIRECT_1a2b'); rc=$?; echo \"$code\" > /tmp/code-canary-rdr; test $rc -eq 0")
    edge.succeed("sleep 1")
    edge.succeed("tail -c +$(($(cat /tmp/off-canary)+1)) /var/log/nginx/manure-access.log > /tmp/canary-window.log")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log /tmp/canary-window.log --absent CANARY_QUERY_7f3a --absent CANARY_PW_9b1c --absent CANARY_REFERER_4d2e --absent CANARY_UA_8c5f --absent CANARY_REDIRECT_1a2b --present-substr 'GET /api/current/nope ' --present-substr ' 404 ' --present-substr ' 301 ' --status-file /tmp/code-canary-api --expect 404")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log /tmp/canary-window.log --status-file /tmp/code-canary-rdr --expect 301")
    # R6-error failure paths (intentional /dev/null for API location):
    # (a) upstream connection-refused 502 with query: access stays sanitized
    # with 502 retained, location errors discarded (no file), global/journal
    # clean; (b) critical access-log write failure (/dev/full bind): alert
    # would leak query via native format despite crit (verified host repro),
    # so the unsafe channel is intentionally disabled; safe observability
    # preserved via typed backend status/body + restored access logs + global
    # errors for non-API contexts (gate liveness is proven once by the
    # probe --selftest above, which drives these same functions).
    edge.succeed("$(readlink -f /proc/$(systemctl show -p MainPID --value nginx.service)/exe) -c /etc/nginx/nginx.conf -T > /tmp/nginx-T.log 2> /tmp/nginx-T.err")
    edge.succeed("! grep -q 'manure-error.log' /tmp/nginx-T.log")
    edge.succeed("grep -E '^\\s*error_log' /tmp/nginx-T.log > /tmp/error-channels.log")
    edge.succeed("systemctl stop manure.service")
    edge.succeed("for i in $(seq 1 30); do if curl -sk -o /dev/null -w '%{http_code}' 'https://api.example.test/api/current/nope?grant=CANARY_ERR502_5a6b' | grep -q 502; then break; fi; sleep 0.2; done")
    edge.succeed("curl -sk 'https://api.example.test/api/current/nope?grant=CANARY_ERR502_5a6b' -o /dev/null -w '%{http_code}' | grep -q 502")
    edge.succeed("sleep 1")
    edge.succeed("journalctl -u nginx --no-pager > /tmp/j502-nginx.log")
    edge.succeed("journalctl -u manure --no-pager > /tmp/j502-manure.log")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log /var/log/nginx/manure-access.log --log /tmp/j502-nginx.log --log /tmp/j502-manure.log --absent CANARY_ERR502_5a6b --present-substr 'GET /api/current/nope '")
    edge.succeed("systemctl start manure.service")
    edge.succeed("for i in $(seq 1 50); do if manure-vm-current-client ready && manure-vm-current-client version; then break; fi; sleep 0.2; done")
    edge.succeed(probe + "ready")
    edge.succeed(probe + "version")
    # R6-error critical: access-log disk-write failure (/dev/full bind).
    # Alert-level native format would leak query despite crit (host repro),
    # so location errors go to /dev/null (intentional); safe observability
    # via exact current backend NotFound/status + global non-API errors. No
    # per-request application logger exists in current Main; never claim one.
    # Restores access
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
    edge.succeed("code=$(curl -sk -o /tmp/crit-api.json -w '%{http_code}' 'https://api.example.test/api/current/nope?grant=CANARY_CRITFULL_CC44'); rc=$?; echo \"$code\" > /tmp/code-crit-api; test $rc -eq 0")
    edge.succeed("code=$(curl -s -o /dev/null -D /tmp/rdr-crit.hdrs -w '%{http_code}' 'http://api.example.test/api/current/nope?tok=CANARY_RDRCRIT_EE66'); rc=$?; echo \"$code\" > /tmp/code-crit-rdr; test $rc -eq 0")
    edge.succeed("grep -q '^Location: ' /tmp/rdr-crit.hdrs")
    edge.succeed("sleep 1")
    edge.succeed("journalctl --after-cursor=\"$(cat /tmp/cur-crit)\" -u nginx --no-pager > /tmp/jcrit-nginx.log")
    edge.succeed("journalctl --after-cursor=\"$(cat /tmp/cur-crit)\" -u manure --no-pager > /tmp/jcrit-manure.log")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log /tmp/jcrit-nginx.log --log /tmp/jcrit-manure.log --absent CANARY_CRITFULL_CC44 --absent CANARY_RDRCRIT_EE66 --status-file /tmp/code-crit-api --expect 404")
    edge.succeed(probe + "check-notfound --file /tmp/crit-api.json --status-file /tmp/code-crit-api")
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
    edge.succeed(probe + "version")
    edge.succeed("tail -c +$(($(cat /tmp/off-restored)+1)) /var/log/nginx/manure-access.log > /tmp/restored-window.log")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log /tmp/restored-window.log --absent CANARY_CRITFULL_CC44 --absent CANARY_RDRCRIT_EE66 --present-substr 'POST /api/current ' --present-substr ' 200 '")
    edge.succeed("code=$(curl -sk -o /dev/null -w '%{http_code}' 'https://api.example.test/api/current/nope?grant=CANARY_POSTRESTORE_DD55'); rc=$?; echo \"$code\" > /tmp/code-postrestore; test $rc -eq 0")
    edge.succeed("sleep 1")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log /var/log/nginx/manure-access.log --absent CANARY_POSTRESTORE_DD55 --present-substr 'GET /api/current/nope ' --status-file /tmp/code-postrestore --expect 404")
    # M2 uses the ACTUAL native service PID/executable and installed share
    # paths; dashboard HTML/current JS/CSS and external zero-file unlock
    # HTML+2 resources must match SERVED bytes. CERT_NONE is transport-only;
    # separate SAN-positive/negative verification follows below.
    edge.succeed(probe + "installed")
    # SAN trust (bounded): positive verifies correct SAN with --cacert
    # (no -k) + --resolve (no DNS changes); negative proves wrong SAN
    # fails verification (do NOT claim assurance from -sk/CERT_NONE).
    edge.succeed(probe + "version-payload > /tmp/version-request.json")
    edge.succeed("curl --cacert /srv/manure-test/cert.crt --resolve api.example.test:443:127.0.0.1 https://api.example.test/api/current -H 'Content-Type: application/json' --data-binary @/tmp/version-request.json > /tmp/version-san.json")
    edge.succeed(probe + "check-version --file /tmp/version-san.json --request /tmp/version-request.json")
    edge.fail("curl --cacert /srv/manure-test/cert.crt --resolve wrong.example:443:127.0.0.1 https://wrong.example/api/current")
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
    # records; cleanup. The restart fault below is explicit: this VM does NOT
    # claim the complementary same-live-server resume case from that step.
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
    edge.succeed("yolo --disable=codegraph --ro-bind /tmp/hm-big.bin,/tmp/hm-big.bin --bind /srv/manure-hm-fetch,/srv/manure-hm-fetch pi -- manure-vm-current-client interrupt-upload --source /tmp/hm-big.bin --output /srv/manure-hm-fetch")
    edge.succeed("grep -q 'killed-exit:137' /srv/manure-hm-fetch/kill-code")
    # ADDITIONAL declared fault: orderly app+nginx restart drains old CLI
    # requests before the authoritative baseline/observer cursor. Status alone
    # cannot fence a chunk still reading its HTTP body before the process gate.
    # Keep the provider PID, payload root, metadata, credential and cache intact.
    edge.succeed("systemctl show -p MainPID --value postgresql.service > /tmp/resume-pg-pid; test $(cat /tmp/resume-pg-pid) -gt 0")
    edge.succeed("stat -c '%d:%i' /srv/manure-data > /tmp/resume-root-identity")
    edge.succeed("systemctl stop manure.service nginx.service")
    edge.succeed("set -eu; for unit in manure nginx; do test $(systemctl show -p MainPID --value $unit.service) -eq 0; test $(systemctl show -p ActiveState --value $unit.service) = inactive; test $(systemctl show -p Result --value $unit.service) = success; test $(systemctl show -p ExecMainStatus --value $unit.service) -ne 9; done")
    edge.succeed("systemctl start manure.service nginx.service")
    edge.wait_for_unit("manure.service")
    edge.wait_for_unit("nginx.service")
    edge.wait_for_open_port(443)
    edge.succeed("test $(systemctl show -p MainPID --value postgresql.service) = $(cat /tmp/resume-pg-pid)")
    edge.succeed("test $(stat -c '%d:%i' /srv/manure-data) = $(cat /tmp/resume-root-identity) && test $(sha256sum /srv/manure-test/token.raw | cut -d' ' -f1) = $(cat /tmp/token-pre)")
    edge.wait_until_succeeds(probe + "ready")
    edge.succeed(probe + "version")
    edge.succeed(probe + "snapshot-status --output /srv/manure-hm-fetch")
    edge.succeed("test $(cat /srv/manure-hm-fetch/rb) -gt 0 && test $(cat /srv/manure-hm-fetch/rb) -lt $(cat /srv/manure-hm-fetch/tot)")
    edge.succeed("test $(cat /srv/manure-hm-fetch/nr) -gt 0")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --log ${hmCacheDir}/uploads/*.json --absent $(cat /srv/manure-test/token.raw) --absent $(sha256sum /srv/manure-test/token.raw | cut -d' ' -f1)")
    edge.succeed("stat -c %s /var/log/nginx/manure-vm-chunks.log > /tmp/resume-chunk-offset")
    edge.succeed("yolo --disable=codegraph --ro-bind /tmp/hm-big.bin,/tmp/hm-big.bin --bind /srv/manure-hm-fetch,/srv/manure-hm-fetch pi -- manure upload /tmp/hm-big.bin --access internal --resume $(cat /srv/manure-hm-fetch/aid1) --json > /srv/manure-hm-fetch/up2.json")
    edge.succeed("grep -q artifact_id /srv/manure-hm-fetch/up2.json")
    edge.succeed("jq -r .artifact_id /srv/manure-hm-fetch/up2.json > /srv/manure-hm-fetch/aid2")
    edge.succeed("PYTHONPATH=/etc/manure-test python3 /etc/manure-test/manure-privacy-check.py --equal-a /srv/manure-hm-fetch/aid1 --equal-b /srv/manure-hm-fetch/aid2")
    edge.succeed(probe + "check-resume --status /srv/manure-hm-fetch/up-status.json --log /var/log/nginx/manure-vm-chunks.log --start-byte $(cat /tmp/resume-chunk-offset)")
    edge.succeed("AID=$(jq -r .artifact_id /srv/manure-hm-fetch/up2.json) && yolo --disable=codegraph --bind /srv/manure-hm-fetch,/srv/manure-hm-fetch pi -- manure fetch $AID /srv/manure-hm-fetch/fetched --json")
    edge.succeed("cmp /tmp/hm-big.bin /srv/manure-hm-fetch/fetched/hm-big.bin")
    edge.succeed("test $(sha256sum /tmp/hm-big.bin | cut -d' ' -f1) = $(sha256sum /srv/manure-hm-fetch/fetched/hm-big.bin | cut -d' ' -f1)")
    edge.succeed("! ls ${hmCacheDir}/uploads/ 2>/dev/null | grep -q .")
  '';
})
