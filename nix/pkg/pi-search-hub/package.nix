{ lib
, stdenvNoCC
, fetchurl
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
# modules." Upstream issue: ronnieops/pi-search-hub#33. When upstream ships a
# fixed manifest, drop this derivation and switch back to the npm: spec.
#
# Pi loads local packages in place and never installs or modifies them ("their
# dependency tree remains the package author's responsibility"), so nothing is
# written to ~/.pi/agent/npm and no dependency copy can exist. Every external
# import of the published 2.8.0 sources resolves through Pi's host module
# aliases (dist/core/extensions/loader.js getAliases maps typebox and the
# @earendil-works/* packages) — verified empirically: the runtime import
# surface of the package is exactly @earendil-works/pi-ai,
# @earendil-works/pi-coding-agent and typebox (all host-aliased), and the
# declared `wreq-js` dependency is never imported at all. On a version bump,
# RE-VERIFY that import surface (grep the tarball for bare specifiers) before
# flipping the pin: a future version importing a non-host package must vendor
# it under $out/node_modules.
#
# The manifest rewrite is exactly the upstream fix from #33 (typebox moves to
# peerDependencies); everything else stays byte-identical to the npm tarball.
stdenvNoCC.mkDerivation rec {
  pname = "pi-search-hub";
  version = "2.8.0";

  src = fetchurl {
    url = "https://registry.npmjs.org/pi-search-hub/-/pi-search-hub-${version}.tgz";
    hash = "sha256-AVs7tkPpzOChCKZV7x5FlSa4pb91f1PdB3HARsF0q7w=";
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
    description = "Unified web search + content extraction extension for pi (vendored manifest fix for ronnieops/pi-search-hub#33)";
    homepage = "https://github.com/ronnieops/pi-search-hub";
    license = lib.licenses.mit;
  };
}
