# Effectual-GoodCommunication: controlled real filesystem, no production state.
{ pkgs }:
pkgs.runCommandLocal "agentic-services-credentials"
  {
    nativeBuildInputs = [ pkgs.python3 ];
    AGENTIC_CREDENTIALS_HELPER = ../hm/agentic-services-credentials.py;
  }
  ''
    python3 ${./test_agentic_services_credentials.py} -v
    touch "$out"
  ''
