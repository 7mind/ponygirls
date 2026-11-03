{ pkgs }:
pkgs.runCommand "provider-strict-private-and-systemd-ACL-contract" {nativeBuildInputs=[pkgs.python3];} ''
  mkdir "$out"
  python3 ${./provider-credential-transport-test.py} ${../postgres/provider.py} "$out/receipt.json"
''
