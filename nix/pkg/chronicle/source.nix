{ lib }:
lib.cleanSourceWith {
  src = ../../../chronicle;
  filter = path: type:
    lib.cleanSourceFilter path type && !(builtins.elem (baseNameOf path) [
      "target" "node_modules" "dist" ".cache" ".local" ".bsp" ".metals" "test-results" "playwright-report" "artifacts"
    ]);
}
