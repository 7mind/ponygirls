{ lib, stdenvNoCC, typescript }:
let
  root = ../../../rites;
in stdenvNoCC.mkDerivation {
  pname = "rites-web";
  version = "0.1.0";
  src = lib.cleanSourceWith {
    src = root;
    filter = path: type:
      let relative = lib.removePrefix "${toString root}/" (toString path);
          selected = entry: relative == entry || lib.hasPrefix "${entry}/" relative
            || (type == "directory" && lib.hasPrefix "${relative}/" entry);
      in toString path == toString root ||
        (lib.cleanSourceFilter path type && !(builtins.elem (baseNameOf path) [ "target" "node_modules" "tests" ])
          && lib.any selected [ "package.json" "web" "generated/typescript" ]);
  };
  nativeBuildInputs = [ typescript ];
  dontConfigure = true;
  buildPhase = ''
    runHook preBuild
    tsc -p web/tsconfig.json
    runHook postBuild
  '';
  installPhase = ''
    mkdir -p "$out/share/rites/web"
    cp -r target/browser/. "$out/share/rites/web/"
    install -Dm644 web/index.html "$out/share/rites/web/index.html"
    install -Dm644 web/styles.css "$out/share/rites/web/web/styles.css"
  '';
  meta = {
    description = "Rites repository automation dashboard";
    license = lib.licenses.mit;
    platforms = lib.platforms.all;
  };
}
