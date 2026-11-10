"""New node-only cases; reuses the once-only native controller, not P1 runs."""
import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import sys
import time

sys.path.insert(0,str(Path(__file__).resolve().parent))
from clef_decisions import DecisionBatch,Limits,Option,Question,Binding,prepare
from p1_experiment import PROMPT_LIMIT,REQUEST_DEADLINE_SECONDS,RESPONSE_BYTES,native_controller,task_options
from preflight import metadata

FAMILY_COUNT=6
CASES_PER_FAMILY=4
BATCH_SIZE=2
RECORD_COUNT=12


def sha(raw):return hashlib.sha256(raw).hexdigest()
def require(ok,code):
    if not ok:raise ValueError(code)
def save(path,value):
    with path.open('x') as stream:stream.write(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n')


def load_cases(path):
    raw=path.read_bytes();data=json.loads(raw)
    require(set(data)=={'schema','cases'} and data['schema']=='clef-p2-public-v1','public-schema')
    cases=data['cases'];ids={f'n{f:02d}-c{c:02d}' for f in range(1,FAMILY_COUNT+1) for c in range(1,CASES_PER_FAMILY+1)}
    require(type(cases) is list and len(cases)==24 and {c['id'] for c in cases}==ids,'public-roster')
    for case in cases:
        require(set(case)=={'id','family','source','node_candidate'} and all(type(v) is str and v.strip() for v in case.values()),'public-fields')
        require(case['family']==case['id'].split('-')[0],'public-family')
    return raw,[dict(c,partition='test') for c in sorted(cases,key=lambda c:c['id'])]


def load_schema(path):
    raw=path.read_bytes();schema=json.loads(raw)
    require(set(schema)=={'task','instructions','options','system_all_sdk_arms'} and schema['task']=='node_kind','question-schema')
    require(schema['options']==[asdict(o) for o in task_options('node_kind')],'p1-node-label-descriptions')
    require(type(schema['instructions']) is str and schema['instructions'].strip() and type(schema['system_all_sdk_arms']) is str and schema['system_all_sdk_arms'].strip(),'instructions')
    return raw,schema


def build_batch(selected,public_sha,index,schema):
    evidence=json.dumps({'cases':[{k:c[k] for k in ('id','source','node_candidate')} for c in selected]},ensure_ascii=False,sort_keys=True,separators=(',',':'))
    binding=Binding('clef-node-p2-source-v1',f'record-{index:02d}',0,public_sha,sha(json.dumps(schema,sort_keys=True,separators=(',',':')).encode()),sha(evidence.encode()))
    options=tuple(Option(o['id'],o['description']) for o in schema['options'])
    questions=tuple(Question(c['id']+'.node_kind',schema['instructions'],options) for c in selected)
    return DecisionBatch(binding,evidence,questions)


def plan(corpus,schema_path,output,tokenizer):
    raw,cases=load_cases(corpus);schema_raw,schema=load_schema(schema_path);limits=Limits(PROMPT_LIMIT,REQUEST_DEADLINE_SECONDS,RESPONSE_BYTES)
    output.mkdir(parents=True,exist_ok=False);(output/'public-cases.json').write_bytes(raw);(output/'question-schema.json').write_bytes(schema_raw)
    rows=[]
    for index in range(1,RECORD_COUNT+1):
        selected=cases[(index-1)*BATCH_SIZE:index*BATCH_SIZE];batch=build_batch(selected,sha(raw),index,schema);prepared=prepare(batch,tokenizer,limits,batch.binding);name=f'record-{index:02d}'
        (output/(name+'.json')).write_bytes(prepared.body);prompt=schema['system_all_sdk_arms']+'\n\n'+prepared.body.decode();(output/(name+'.llm.txt')).write_text(prompt)
        rows.append({'index':index,'case_ids':[c['id'] for c in selected],'family':selected[0]['family'],'partition':'test','request':name+'.json','request_sha256':prepared.sha256,'llm_prompt_sha256':sha(prompt.encode()),'full_input_tokens':prepared.untruncated_input_tokens,'question_ids':[q.id for q in batch.questions]})
    manifest={'kind':'clef-p2-node-plan-v1','created_unix_ns':time.time_ns(),'public_sha256':sha(raw),'question_schema_sha256':sha(schema_raw),'records':rows,'cases':24,'questions':24,'roster_records':12,'inference':False}
    save(output/'plan.json',manifest);print(json.dumps({'planned_records':12,'questions':24,'inference':False}))


def native(plan_root,output,tokenizer,release,release_sha):
    raw,schema=load_schema(plan_root/'question-schema.json');manifest=json.loads((plan_root/'plan.json').read_bytes())
    require(sha(raw)==manifest['question_schema_sha256'],'schema-pin')
    def builder(cases,public_sha,index):return build_batch(cases,public_sha,index,schema)
    return native_controller(plan_root,output,tokenizer,release,release_sha,load_cases,builder,schema['system_all_sdk_arms'],BATCH_SIZE,RECORD_COUNT)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=('plan','native'));p.add_argument('--corpus',type=Path);p.add_argument('--schema',type=Path);p.add_argument('--plan',type=Path);p.add_argument('--release',type=Path);p.add_argument('--release-sha256');p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if a.action=='plan' and (a.corpus is None or a.schema is None):raise ValueError('corpus/schema required')
    if a.action=='native' and (a.plan is None or a.release is None or a.release_sha256 is None):raise ValueError('plan/release/SHA required')
    _,model_path=metadata()
    from transformers import AutoTokenizer
    tokenizer=AutoTokenizer.from_pretrained(model_path,local_files_only=True,trust_remote_code=False)
    if a.action=='plan':plan(a.corpus,a.schema,a.output,tokenizer)
    else:native(a.plan,a.output,tokenizer,a.release,a.release_sha256)
