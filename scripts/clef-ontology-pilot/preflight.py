"""Owned native CLEF engineering preflight; no benchmark/quality claims or retries."""
import argparse
from dataclasses import asdict
import hashlib
import http.client
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from clef_decisions import (Binding, DecisionBatch, DecisionClient, Limits,
                           LoopbackTransport, Option, Question, assess, pieces, prepare)

EXPECTED_REVISION = 'cfddda043dd190ef3b01cff449d5ee8cff1e8ec6'
PROMPT_LIMIT = 8192
REQUEST_DEADLINE_SECONDS = 180.0
RESPONSE_BYTES = 1024 * 1024
METADATA_BYTES = 262144


def metadata():
    properties = subprocess.check_output(['/usr/bin/systemctl', '--user', 'show', 'clef.service', '-p', 'MainPID', '-p', 'ActiveState', '-p', 'SubState'], text=True)
    service = dict(line.split('=', 1) for line in properties.splitlines())
    if service['ActiveState'] != 'active' or service['SubState'] != 'running':
        raise ValueError('service not ready')
    argv = Path('/proc', service['MainPID'], 'cmdline').read_bytes().decode().split('\x00')
    selected = {}
    for flag in ('--model-path', '--served-model-name', '--host', '--port', '--dtype', '--context-length', '--max-prefill-tokens'):
        index = argv.index(flag)
        selected[flag] = argv[index + 1]
    expected = {'--served-model-name':'Cloudflare/clef','--host':'127.0.0.1','--port':'30000','--dtype':'bfloat16','--context-length':'8199','--max-prefill-tokens':'8192'}
    if any(selected[key] != value for key, value in expected.items()):
        raise ValueError('serving profile changed')
    http_metadata = {}
    for route in ('/health', '/model_info'):
        connection = http.client.HTTPConnection('127.0.0.1', 30000, timeout=15)
        try:
            connection.request('GET', route)
            response = connection.getresponse()
            body = response.read(METADATA_BYTES + 1)
            if response.status != 200 or len(body) > METADATA_BYTES:
                raise ValueError('metadata unavailable')
            http_metadata[route] = json.loads(body) if body.strip() else None
        finally:
            connection.close()
    info = http_metadata['/model_info']
    model_path = Path(info['model_path'])
    if info['served_model_name'] != 'Cloudflare/clef' or info['is_generation'] is not False or model_path.name != EXPECTED_REVISION or selected['--model-path'] != str(model_path):
        raise ValueError('model identity mismatch')
    version = importlib.metadata.version('sglang')
    if version != '0.5.23':
        raise ValueError('SGLang version mismatch')
    return {'service':service,'selected_process_flags':selected,'http':http_metadata,'sglang_version':version,'weight_bytes_authenticated':False}, model_path


def run(output):
    output.mkdir(parents=True, exist_ok=False)
    observed, model_path = metadata()
    local_source_hashes = {}
    for name in ('joint_schema_model.py', 'joint_head_config.json', 'config.json', 'tokenizer.json', 'tokenizer_config.json'):
        local_source_hashes[name] = hashlib.sha256((model_path / name).read_bytes()).hexdigest()
    if local_source_hashes['joint_schema_model.py'] != '0e304cf7c6500e8bb59bef7e2afd2c6373f82596dfb3b57d1aa93c175e2dc3a3':
        raise ValueError('local published encoder differs from inspected source')
    observed['local_selected_file_hashes'] = local_source_hashes
    observed['started_unix_ns'] = time.time_ns()
    (output/'before.json').write_text(json.dumps(observed, indent=2)+'\n')
    from transformers import AutoTokenizer
    from sglang.srt.entrypoints.systemone.protocol import SystemOneRequest
    from sglang.srt.entrypoints.systemone.joint_schema import encode_joint_schema
    tokenizer = AutoTokenizer.from_pretrained(str(model_path), local_files_only=True, trust_remote_code=False)
    limits = Limits(PROMPT_LIMIT, REQUEST_DEADLINE_SECONDS, RESPONSE_BYTES)
    client = DecisionClient(LoopbackTransport('http://127.0.0.1:30000/v1/systemone', limits), tokenizer, limits)
    # Deliberately simple public synthetic transport controls, not held-out tasks.
    cases = (('paid', 'paid', 'EUR'), ('unpaid', 'unpaid', 'USD'), ('unicode', 'paid', 'JPY'))
    outcomes = []
    for index, (name, status, currency) in enumerate(cases):
        case_dir = output/f'{index+1:02d}-{name}'
        case_dir.mkdir()
        evidence = json.dumps({'invoice_id':'synthetic-'+name,'status':status,'currency':currency,'vendor':'Café 東京'},ensure_ascii=False,sort_keys=True)
        binding = Binding('engineering-preflight-001',name,0,'invoice-1','choice-transport-1',hashlib.sha256(evidence.encode()).hexdigest())
        questions = (
            Question('status','What payment status is explicitly recorded for this invoice?',(Option('paid','The invoice status is paid.'),Option('unpaid','The invoice status is unpaid.'))),
            Question('currency','What currency is explicitly recorded for this invoice?',tuple(Option(code,'The recorded currency is '+code+'.') for code in ('EUR','USD','JPY'))),
        )
        if index % 2:
            questions = tuple(reversed(questions))
        batch = DecisionBatch(binding,evidence,questions)
        prepared = prepare(batch,tokenizer,limits,binding)
        request = json.loads(prepared.body)
        native_ids, _ = encode_joint_schema(tokenizer,SystemOneRequest.model_validate(request),max_length=PROMPT_LIMIT,image_token_counts=[])
        own_ids = [token for piece in pieces(batch) for token in tokenizer.encode(piece,add_special_tokens=False)]
        if native_ids != own_ids or len(native_ids) != prepared.untruncated_input_tokens:
            raise ValueError('independent compiler/tokenizer parity mismatch BEFORE inference')
        (case_dir/'request.json').write_bytes(prepared.body)
        (case_dir/'admission.json').write_text(json.dumps({'full_input_tokens':len(own_ids),'native_compiler_full_id_sequence_matches':True,'max_prompt_tokens':PROMPT_LIMIT,'source_sha256':binding.source_sha256,'request_sha256':prepared.sha256},indent=2)+'\n')
        capture = client.invoke(batch,binding)
        (case_dir/'response.bin').write_bytes(capture.http.body)
        (case_dir/'transport.json').write_text(json.dumps({'status':capture.http.status,'elapsed_ns':capture.http.elapsed_ns,'error':capture.http.error},indent=2)+'\n')
        try:
            assessment = assess(capture,binding)
            actual = {answer.question:answer.selected for answer in assessment.answers}
            accepted = actual == {'status':status,'currency':currency}
            outcome = {'case':name,'transport_schema_accepted':True,'synthetic_control_matches':accepted,'assessment':asdict(assessment)}
        except Exception as error:
            outcome = {'case':name,'transport_schema_accepted':False,'error_type':type(error).__name__,'error_code':str(error)}
        (case_dir/'outcome.json').write_text(json.dumps(outcome,indent=2)+'\n')
        outcomes.append(outcome)
    after, _ = metadata()
    (output/'after.json').write_text(json.dumps(after,indent=2)+'\n')
    result = {'ended_unix_ns':time.time_ns(),'scope':'engineering native transport/compiler/schema controls ONLY','original_or_quality_pilot':False,'no_weights_loaded_in_client':True,'no_deployment_mutation':True,'same_service_parent':observed['service']['MainPID']==after['service']['MainPID'],'cases':outcomes}
    (output/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'engineering_requests':len(outcomes),'accepted':sum(o['transport_schema_accepted'] and o['synthetic_control_matches'] for o in outcomes),'same_service_parent':result['same_service_parent'],'benchmark_quality_result':False}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True,type=Path)
    run(parser.parse_args().output)
