{ lib
, buildNpmPackage
, pi-coding-agent
, ponygirls-pi-ui
}:

let
  sdk = "${pi-coding-agent}/lib/node_modules/pi-monorepo";
in
buildNpmPackage {
  pname = "pi-search-hub";
  version = "2.8.0-ponygirls.1";
  src = lib.cleanSourceWith {
    src = ./src;
    filter = path: _type: !(lib.hasSuffix "/node_modules" path);
  };
  npmDepsHash = "sha256-5elDMmTt+jh2rSvZ0VlwBshkFyFzmz9jfhS3C7kW5Cs=";
  npmFlags = [ "--legacy-peer-deps" "--ignore-scripts" ];
  dontNpmBuild = true;
  doCheck = true;

  preCheck = ''
    mkdir -p node_modules/@earendil-works node_modules/@ponygirls
    ln -s ${sdk} node_modules/@earendil-works/pi-coding-agent
    for package in pi-ai pi-agent-core pi-tui; do
      ln -s ${sdk}/node_modules/@earendil-works/$package node_modules/@earendil-works/$package
    done
    ln -s ${sdk}/node_modules/typebox node_modules/typebox
    ln -s ${ponygirls-pi-ui} node_modules/@ponygirls/pi-ui
    export HOME=$TMPDIR/search-test-home
    mkdir -p "$HOME"
  '';
  checkPhase = ''
    runHook preCheck
    npm run typecheck
    npm test
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall
    npm prune --omit=dev --ignore-scripts --legacy-peer-deps --offline
    mkdir -p $out
    cp -r extensions backends package.json CREDITS.md node_modules $out/
    mkdir -p $out/node_modules/@ponygirls
    ln -s ${ponygirls-pi-ui} $out/node_modules/@ponygirls/pi-ui
    runHook postInstall
  '';

  meta = {
    description = "Vendored Pi metasearch with main, fallback and native-provider tiers and an interactive diagnostics pane";
    homepage = "https://github.com/ronnieops/pi-search-hub";
    license = lib.licenses.mit;
  };
}
