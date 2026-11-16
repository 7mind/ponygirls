# Compile the authoritative generated codecs once for extension consumers.
{ runCommand, typescript }:
runCommand "ponygirls-chronicle-api" {
  nativeBuildInputs = [ typescript ];
  src = ../../../chronicle/generated/typescript;
} ''
  cp -r $src source
  chmod -R u+w source
  cd source
  printf '%s\n' '{"name":"@ponygirls/chronicle-api","version":"1.9.0","type":"module","exports":{"./*":"./*"}}' > package.json
  tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck \
    --declaration --rootDir . --outDir "$out" \
    chronicle/api/IngestRequest.ts chronicle/api/IngestReceipt.ts
  cp package.json "$out/package.json"
''
