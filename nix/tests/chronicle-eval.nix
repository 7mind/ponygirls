# Relevance-evaluation unit tests: Python unittest and Node test files of chronicle/eval/relevance (no live providers).
{ runCommand, callPackage, python3, nodejs_24 }:
let
  sources = callPackage ../pkg/chronicle/source.nix { };
  python = python3.withPackages (packages: [ packages.unittest-xml-reporting ]);
in runCommand "chronicle-eval" {
  nativeBuildInputs = [ python nodejs_24 ];
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
} ''
  cp -r ${sources.eval} source
  chmod -R u+w source
  cd source
  status=0
  mkdir -p "$out/node"
  python3 -m xmlrunner --output "$out/python" --outsuffix "" discover -s eval/relevance/tests -v || status=$?
  node --test --test-reporter=spec --test-reporter-destination=stdout \
    --test-reporter=junit --test-reporter-destination="$out/node/eval.xml" eval/relevance/tests/*.test.mjs || status=$?
  python3 ${../../scripts/junit-gate.py} --counts "$out/counts.json" "$out/python" "$out/node"
  exit "$status"
''
