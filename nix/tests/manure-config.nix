# Native check-config parses config only; referenced secrets/roots/DB/models must
# not be opened. Special-file references make accidental IO fail boundedly.
{ pkgs, manurePackage }:
let native=manurePackage.nativeArtifact;
in pkgs.runCommand "manure-native-config-only-boundary" {
  nativeBuildInputs=[pkgs.python3];
} ''
  mkdir "$out"
  python3 - ${native}/libexec/manure-server "$out/receipt.json" <<'PY'
  import hashlib,json,os,pathlib,subprocess,sys,tempfile
  artifact=pathlib.Path(sys.argv[1]);passed=[]
  with tempfile.TemporaryDirectory(prefix='manure-config-only-') as directory:
      root=pathlib.Path(directory);fifo=root/'must-not-open';os.mkfifo(fifo,0o600)
      control=root/'must-not-create-control';data=control/'data'
      config={'posix_library':None,'data_dir':str(data),'migration_receipt_dir':str(control),'api_origin':'http://127.0.0.1:12345','port':12345,'loopback_dev':True,'content_mode':'path',
          'database':{'jdbcUrl':'jdbc:postgresql://127.0.0.1:1/not-live','user':'manure','passwordFile':str(fifo),'limits':{'maxConnections':4,'maxQueued':16,'queueTimeoutMs':5000,'connectTimeoutMs':5000,'statementTimeoutMs':30000,'lockTimeoutMs':5000,'idleTransactionTimeoutMs':30000,'socketTimeoutMs':30000}},
          'users':[{'id':'fixture','type':'human','tokens':[{'id':'primary','hashFile':str(fifo)}]}],
          'embedding':{'operationUrl':'http://127.0.0.1:1/v1/embeddings','model':'fixture','revision':'immutable-fixture','dimensions':2,'sendDimensions':False,'documentPrefix':"",'queryPrefix':"",'normalization':'cosine','credentialFile':str(fifo),'deadlineMs':1000,'maxResponseBytes':65536,'maxBatch':1,'maxInputBytes':8192,'maxRequestBytes':65536,'maxConcurrent':1,'maxQueued':1,'batchSize':1,'leaseSeconds':30,'pollIntervalMs':1000}}
      path=root/'config.json'
      def invoke():
          path.write_text(json.dumps(config));return subprocess.run([str(artifact),'check-config',str(path)],capture_output=True,text=True,timeout=5)
      result=invoke();assert result.returncode==0 and result.stdout.strip()=='MANURE_CONFIG_OK'
      assert not data.exists() and not control.exists()
      passed.append('parse-only-no-secret-fifo-root-db-or-model-io')
      config.update(loopback_dev=False,allow_insecure_http=True,allowed_api_origins=['http://localhost:12345'])
      assert invoke().returncode==0
      passed.append('valid-distinct-alias-parses-without-referenced-io')
      config['allowed_api_origins']=[config['api_origin']]
      assert invoke().returncode!=0
      passed.append('duplicate-primary-origin-alias-rejected')
      config['allowed_api_origins']=['http://localhost:12345','http://localhost:12345']
      assert invoke().returncode!=0
      passed.append('duplicate-alias-list-rejected')
  pathlib.Path(sys.argv[2]).write_text(json.dumps({'tests':passed,'cases':len(passed),'failures':0,'errors':0,'skips':0,'artifact':str(artifact),'artifactSHA256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'scope':'Native config-only parsing and duplicate-origin validation; no deployment/runtime startup acceptance.'},indent=2)+'\n')
  PY
''
