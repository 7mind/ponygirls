{ runCommand, makeWrapper, python3, postgresql_18 }:
runCommand "ponygirls-postgres-tools" { nativeBuildInputs = [ makeWrapper ]; meta.platforms = [ "x86_64-linux" ]; } ''
  mkdir -p "$out/bin" "$out/libexec"
  cp ${../../postgres/backup.py} "$out/libexec/backup.py"
  makeWrapper ${python3}/bin/python3 "$out/bin/ponygirls-postgres-backup" \
    --add-flags "$out/libexec/backup.py" \
    --prefix PATH : ${postgresql_18}/bin
''
