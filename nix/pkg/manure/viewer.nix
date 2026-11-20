{ lib, buildNpmPackage, nodejs_24 }:
buildNpmPackage {
  pname = "manure-viewer";
  version = "0.1.0";
  src = lib.cleanSourceWith {
    src = ../../../manure/web/viewer;
    filter = path: type: lib.cleanSourceFilter path type && !(builtins.elem (baseNameOf path) [ "node_modules" "dist" "test-results" ]);
  };
  nodejs = nodejs_24;
  npmDepsHash = "sha256-gJSRsuQoV5VubRUu+xA7aheA4Oftm1+NZXUYG6H02XE=";
  npmFlags = [ "--ignore-scripts" ];
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    npm test
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/share/manure/web/viewer"
    cp dist/* "$out/share/manure/web/viewer/"
    runHook postInstall
  '';
  meta = {
    description = "Offline, bounded Manure document and diagram browser viewer";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
  };
}
