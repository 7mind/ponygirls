# Preserve the historical public check name, NOT the retired Python backend.
# This is now a strict composition of all replacement executable gates. Every
# dependency must really execute/pass; no mocked adapter or cached empty summary.
{ pkgs, backendCheck, installedClientCheck, nativeCheck, portableRootCheck }:
pkgs.runCommand "manure-current-acceptance-composition" {
  nativeBuildInputs=[pkgs.python3];
} ''
  python3 - ${backendCheck}/receipt.json ${nativeCheck}/receipt.json ${installedClientCheck}/receipt.json ${portableRootCheck}/receipt.json <<'PY'
  import hashlib,json,sys
  from pathlib import Path
  backend,native,client,portable=[json.load(open(path)) for path in sys.argv[1:]]
  assert set(backend['modules'])=={'manure/backend','manure/server'} and all(v['cases']>0 for v in backend['modules'].values())
  assert native['artifactKind']=='native' and native['targetScope']=='full'
  assert native['tests']>0 and native['inventoryMatches']
  assert all(backend[k]==0 for k in ['failures','errors','skips'])
  assert client['cases']>0 and client['cases']==len(client['tests']) and all(client[k]==0 for k in ['failures','errors','skips'])
  assert all(native[k]==0 for k in ['failures','errors','skipped'])
  required={'planOnlyNonAdopting','applied','freshPodExactReplay','schemaMigrateAfterApplied',
            'portableNativeServeAndContent','nativeAuthDenials','nativeHeldRootDenial',
            'nativeCrossNetworkNamespaceRootDenial','modeledForeignVolumeDenied',
            'nativeMarkerTamperDenied','sameVolumeInodeCopyDenied','nativeRestoredRootReopens',
            'nativeUnknownCaAndWrongSanDenied'}
  assert set(portable['checks'])==required and len(portable['checks'])==len(required)
  assert all(portable[key] is True for key in required)
  assert portable['bindingBytes']==[16,76] and portable['artifactKind']=='native'
  assert portable['realKubernetesAcceptance'] is False
  assert portable['scope']=='owned native static-musl portable CLI/runtime/PG/TLS/private-mount probe; NOT real Kubernetes/node handoff'
  assert all(portable[key]==native[key] for key in ['artifact','runtimeSource','testSource'])
  assert portable['nativeElfSha256']==hashlib.sha256(Path(native['artifact']).read_bytes()).hexdigest()
  PY
  test -e ${installedClientCheck}
  mkdir "$out"
  ln -s ${backendCheck} "$out/backend-jvm-real-pg-filesystem"
  ln -s ${installedClientCheck} "$out/installed-cli-official-mcp-resume"
  ln -s ${nativeCheck} "$out/native-full-target-and-browser"
  ln -s ${portableRootCheck} "$out/portable-root-native-vm"
  cp ${./manure-check-matrix.md} "$out/check-matrix.md"
''
