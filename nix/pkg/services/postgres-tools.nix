{ lib, runCommand, makeWrapper, python3, postgresql_18 }:
let
  migrationSource = lib.cleanSourceWith { src = ../../../manure/migration; filter = path: type: builtins.elem (baseNameOf path) [ "migration" "offline.py" "schema.sql" ]; };
in runCommand "ponygirls-postgres-tools" { nativeBuildInputs = [ makeWrapper ]; meta.platforms = [ "x86_64-linux" ]; } ''
  mkdir -p "$out/bin" "$out/libexec" "$out/share/manure-migration"
  cp ${../../postgres/backup.py} "$out/libexec/backup.py"
  cp ${migrationSource}/{offline.py,schema.sql} "$out/share/manure-migration/"
  makeWrapper ${python3}/bin/python3 "$out/bin/ponygirls-postgres-backup" \
    --add-flags "$out/libexec/backup.py" \
    --set PONYGIRLS_MANURE_OFFLINE_TOOL "$out/share/manure-migration/offline.py" \
    --prefix PATH : ${postgresql_18}/bin
  makeWrapper ${python3}/bin/python3 "$out/bin/manure-offline" \
    --add-flags "$out/share/manure-migration/offline.py" --prefix PATH : ${postgresql_18}/bin
''
