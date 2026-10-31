# Generic offline package check; downstream service wiring is checked downstream.
{ pkgs, package }:
pkgs.runCommand "crawl4ai-startup" { } ''
  export PYTHONDONTWRITEBYTECODE=1
  ${package.passthru.pythonEnv}/bin/python ${./crawl4ai-startup.py} ${package.passthru.serverRoot}
  touch "$out"
''
