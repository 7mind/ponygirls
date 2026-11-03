{ lib, buildNpmPackage }:
buildNpmPackage {
  pname = "haystack-web";
  version = "0.1.0";
  src = lib.cleanSourceWith {
    src = ../../../haystack;
    filter = path: type:
      let root = toString ../../../haystack; relative = lib.removePrefix "${root}/" (toString path);
      in !(builtins.elem (baseNameOf path) [ "node_modules" "dist" "target" "test-results" "playwright-report" ]) &&
        (toString path == root || builtins.elem relative [ "package.json" "package-lock.json" "server" "server/package.json" "generated" "scripts" "scripts/register-generated.mjs" ] || lib.hasPrefix "web/" relative || relative == "web" || lib.hasPrefix "generated/typescript" relative);
  };
  npmDepsHash = "sha256-WlhsXvvdzXnucSg0stQCCbL3u4ZqBauo3h4LMMBjPKE=";
  buildPhase = ''
    runHook preBuild
    npm run typecheck -w web
    npm run build:web
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    npm test -w web
    runHook postCheck
  '';
  installPhase = ''
    mkdir -p "$out/share/haystack/web"
    cp -r web/dist/. "$out/share/haystack/web/"
  '';
}
