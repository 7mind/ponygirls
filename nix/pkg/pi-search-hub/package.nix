{ lib
, stdenvNoCC
, fetchFromGitHub
, jq
}:

# pi-search-hub as a Pi LOCAL package with a corrected manifest, instead of
# the `npm:pi-search-hub@<version>` managed install (see nix/hm/pi.nix).
#
# Defect (pi-search-hub package.json): the host-provided `typebox` package is
# declared in `dependencies` instead of `peerDependencies` with a "*" range
# (Pi's packaging contract, docs/packages.md "Declare dependencies"). Pi's
# managed install therefore materialises a SECOND physical typebox copy under
# ~/.pi/agent/npm/node_modules (at its own resolved version) and warns on
# every startup: "Host-provided extension packages must be declared in
# peerDependencies with a "*" range, not dependencies: typebox. Installed
# copies can bypass the extension loader and create duplicate runtime
# modules." Upstream issue: ronnieops/pi-search-hub#33 (still open; main's
# manifest is unchanged).
#
# Source pin: GitHub main, NOT the npm tarball. The configurable web_read
# reader-fallback feature (`readerFallback` config; web_read falls through an
# ordered reader chain on 422/5xx/network errors, 401/403 stay fatal) is
# merged on main as the intended v2.9.0, but the npm publish failed silently
# and the registry still tops out at 2.8.0 — upstream issue
# ronnieops/pi-search-hub#36 (open). When npm carries >= 2.9.0, switch src
# back to the registry tarball and drop this paragraph.
#
# Pi loads local packages in place and never installs or modifies them ("their
# dependency tree remains the package author's responsibility"), so nothing is
# written to ~/.pi/agent/npm and no dependency copy can exist. Every external
# import of the sources at this pin resolves through Pi's host module aliases
# (dist/core/extensions/loader.js getAliases maps typebox and the
# @earendil-works/* packages) — re-verified at this pin: the runtime import
# surface is exactly @earendil-works/pi-ai, @earendil-works/pi-coding-agent
# and typebox (all host-aliased) plus node:* builtins; `vitest` is imported
# only by test files and the declared `wreq-js` dependency is never imported
# at all. On a pin bump, RE-VERIFY that import surface (grep the tarball for
# bare specifiers): a future revision importing a non-host package must vendor
# it under $out/node_modules.
#
# The manifest rewrite is exactly the upstream fix from #33 (typebox moves to
# peerDependencies); everything else stays byte-identical to the pinned
# revision.
stdenvNoCC.mkDerivation rec {
  pname = "pi-search-hub";
  # Intended upstream v2.9.0, unreleased on npm (see header).
  version = "2.8.0-unstable-2026-07-24";

  src = fetchFromGitHub {
    owner = "ronnieops";
    repo = "pi-search-hub";
    rev = "6dd5188";
    hash = "sha256-3LcRegB1PkMjM9xEhZPk98h/2NrE0gFkgw0PaNMIwl0=";
  };

  nativeBuildInputs = [ jq ];

  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out
    cp -r . $out
    chmod -R u+w $out

    jq \
      '.dependencies |= del(.typebox)
       | .peerDependencies = ((.peerDependencies // {}) + { typebox: "*" })' \
      $out/package.json > package.json.fixed
    mv package.json.fixed $out/package.json

    # Fail fast if a pin bump changes the manifest shape this fix assumes.
    jq -e '.dependencies | has("typebox") | not' $out/package.json > /dev/null
    jq -e '.peerDependencies.typebox == "*"' $out/package.json > /dev/null
    jq -e '.pi.extensions == ["./extensions/search-hub.ts"]' $out/package.json > /dev/null

    runHook postInstall
  '';

  meta = {
    description = "Unified web search + content extraction extension for pi (main pin for reader fallback, ronnieops/pi-search-hub#36; vendored manifest fix for #33)";
    homepage = "https://github.com/ronnieops/pi-search-hub";
    license = lib.licenses.mit;
  };
}
