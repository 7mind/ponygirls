let
  codexCatalogPath = piBase: "${piBase.src}/packages/ai/catalog/providers/openai-codex.ts";
  latestSolModel = source: text:
    let
      ids = builtins.concatLists (builtins.filter builtins.isList (builtins.split "\"(gpt-[0-9.]+-sol)\"" text));
      versionOf = id: builtins.head (builtins.match "gpt-([0-9.]+)-sol" id);
      newest = builtins.foldl' (best: id: if best == null || builtins.compareVersions (versionOf id) (versionOf best) > 0 then id else best) null ids;
    in
    if newest == null then throw "no gpt-*-sol model in ${source}; update nix/lib/pi-catalog.nix or set programs.pi.historian.model explicitly" else newest;
in
{
  inherit codexCatalogPath latestSolModel;
  latestCodexSolModel = piBase: latestSolModel (codexCatalogPath piBase) (builtins.readFile (codexCatalogPath piBase));
}
