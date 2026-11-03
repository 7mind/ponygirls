let
  flake = builtins.getFlake "git+file:///home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-unified-nix?rev=521e9b005e3712751cb80e3160b905c69aa72a45";
  pkgs = import flake.inputs.nixpkgs { system = "x86_64-linux"; };
  native = flake.packages.x86_64-linux.manure.nativeArtifact;
in native.overrideAttrs (old: {
  pname = "manure-canonical-sql-negative-probe";
  src = pkgs.runCommand "manure-intentionally-mismatched-source" {} ''
    cp -r ${old.src} "$out"
    chmod -R u+w "$out"
    printf '\n-- intentional test-only SQL mismatch\n' >> "$out/manure/backend/src/main/resources/manure-schema.sql"
  '';
})
