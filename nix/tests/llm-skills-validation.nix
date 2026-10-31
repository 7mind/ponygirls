# BG: validator CLI with real yq and ephemeral filesystem fixtures, offline.
{ pkgs }:
pkgs.runCommand "llm-skills-validation" {
  nativeBuildInputs = [ pkgs.python3 pkgs.yq-go ];
} ''
  export PYTHONDONTWRITEBYTECODE=1
  python3 ${../pkg/llm-skills/validate-skills-test.py} ${../pkg/llm-skills/validate-skills.sh} -v
  touch "$out"
''
