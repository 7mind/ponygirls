{ lib, runCommand, fetchurl, python3, nodejs_24, unzip, pi-coding-agent, pi-search-hub }:
let
  lock = builtins.fromJSON (builtins.readFile ./data.lock.json);
  artifact = record: fetchurl { inherit (record) url sha256; };
  bundle = artifact lock.bundle;
  qrels19 = artifact (builtins.elemAt lock.qrels 0);
  qrels20 = artifact (builtins.elemAt lock.qrels 1);
in
runCommand "pi-search-hub-fusion-evaluation" {
  nativeBuildInputs = [ python3 nodejs_24 unzip ];
  src = lib.cleanSourceWith {
    src = ./.;
    filter = path: _type: !(lib.hasSuffix ".md" path) && !(builtins.elem (baseNameOf path) [ "__pycache__" ".cache" "results" ]);
  };
  PI_SDK_ROOT = "${pi-coding-agent}/lib/node_modules/pi-monorepo";
  SEARCH_HUB_ROOT = pi-search-hub;
  PYTHONDONTWRITEBYTECODE = "1";
} ''
  cp -r $src eval
  chmod -R u+w eval
  cd eval
  mkdir data
  unzip -q ${bundle} -d data
  cp ${qrels19} data/qrels.dl19-passage.txt
  cp ${qrels20} data/qrels.dl20-passage.txt
  python3 -m unittest discover -s . -p 'test_*.py' -v
  python3 evaluate.py development --data-dir data --output development.json
  python3 evaluate.py heldout --data-dir data --selection development.json --output heldout.json
  echo '9a5b2f1642b7cf958f78ef1e529a958b4cda240b78203f09402ac8b0ad9b9bcb  development.json' | sha256sum -c -
  echo '51f98babbc53c01b29b87ea023391372a6a384d76ec70c8d53c429c7e424a1ca  heldout.json' | sha256sum -c -
  python3 replay_live.py --input fixtures/live-public-20261107.json --output live.json
  node check-production.mjs
  touch $out
''
