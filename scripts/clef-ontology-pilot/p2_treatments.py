"""Build source-bound P2 advice/cascade arms from closed native scores, never Gold."""
import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys
import time

sys.path.insert(0,str(Path(__file__).resolve().parent))
from clef_decisions import Capture,HttpResult,Prepared,assess
from p2_experiment import RECORD_COUNT,build_batch,load_cases,load_schema,require,save,sha

THRESHOLD=0.50
ROTATION=('task','constraint','claim','observation','hypothesis','unknown')
ARMS=('baseline','advice','altered','cascade')


def rotate(probabilities):
    require(set(probabilities)==set(ROTATION),'rotation-options')
    return {ROTATION[(i+1)%len(ROTATION)]:probabilities[key] for i,key in enumerate(ROTATION)}


def accepted(label,probabilities):
    return label is not None and label!='unknown' and probabilities is not None and max(probabilities.values())>=THRESHOLD


def inventory(root):
    rows=[]
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(),'native-link')
        if path.is_file():
            raw=path.read_bytes();rows.append({'path':str(path.relative_to(root)),'bytes':len(raw),'sha256':sha(raw)})
        else:require(path.is_dir(),'native-special')
    return rows


def verify_native_closure(root,ended,roster):
    started=ended['invocation_started_records'];outcomes=ended['outcome_records'];unattempted=ended['unattempted_records'];unknown=ended['started_without_outcome_records']
    for values in (started,outcomes,unattempted,unknown):require(type(values) is list and len(set(values))==len(values) and all(type(v) is int and v in roster for v in values),'native-closure-roster')
    require(set(outcomes)<=set(started) and unattempted==[i for i in roster if i not in started] and unknown==[i for i in started if i not in outcomes],'native-closure-roster')
    if ended['status']=='complete':require(started==roster and outcomes==roster,'native-closure-complete')
    for index in roster:
        slot=root/f'record-{index:02d}';outcome=slot/'outcome.json'
        if index in outcomes:
            require(all((slot/name).is_file() for name in ('outcome.json','transport.json','response.bin','started.json')),'native-closure-artifact')
            require(json.loads(outcome.read_bytes())['index']==index,'native-closure-artifact')
        else:require(not outcome.exists(),'native-closure-artifact')


def build(plan_root,native_root,output):
    require(not output.exists(),'output-exists');manifest=json.loads((plan_root/'plan.json').read_bytes());raw,cases=load_cases(plan_root/'public-cases.json');schema_raw,schema=load_schema(plan_root/'question-schema.json');ended=json.loads((native_root/'ended.json').read_bytes())
    require(manifest['kind']=='clef-p2-node-plan-v1' and manifest['public_sha256']==sha(raw) and manifest['question_schema_sha256']==sha(schema_raw),'plan-pins')
    require(ended['status'] in ('complete','aborted') and ended['roster_records']==list(range(1,13)),'native-closure')
    require([r['index'] for r in manifest['records']]==list(range(1,13)),'plan-record-roster')
    verify_native_closure(native_root,ended,list(range(1,13)))
    before=inventory(native_root);output.mkdir(parents=True,exist_ok=False);(output/'public-cases.json').write_bytes(raw);(output/'question-schema.json').write_bytes(schema_raw)
    for arm in ARMS:(output/arm).mkdir()
    arm_rows={arm:[] for arm in ARMS};skipped=[];source_rows=[]
    for record in manifest['records']:
        index=record['index'];require(record['request']==f'record-{index:02d}.json','record-path');body=(plan_root/record['request']).read_bytes();require(sha(body)==record['request_sha256'],'record-pin');selected=cases[(index-1)*2:index*2];batch=build_batch(selected,sha(raw),index,schema);require(record['case_ids']==[c['id'] for c in selected] and record['question_ids']==[q.id for q in batch.questions],'record-identity');slot=native_root/f'record-{index:02d}';assessment=None
        if (slot/'outcome.json').is_file():
            outcome=json.loads((slot/'outcome.json').read_bytes())
            if outcome['valid'] is True:
                transport=json.loads((slot/'transport.json').read_bytes());prepared=Prepared(batch,body,sha(body),record['full_input_tokens']);capture=Capture(prepared,HttpResult(transport['status'],(slot/'response.bin').read_bytes(),transport['elapsed_ns'],transport['error']))
                assessment=assess(capture,batch.binding);require(outcome['assessment']==json.loads(json.dumps(asdict(assessment),allow_nan=False)),'native-assessment-source')
        packets=[];altered=[];decisions=[]
        for c in selected:
            qid=c['id']+'.node_kind'
            if assessment is None:
                packet={'question_id':qid,'status':'unavailable','provenance':'experimental_secondary_assessment','probabilities':None};decision={'question_id':qid,'native_label':None,'accepted':False}
            else:
                answer=next(a for a in assessment.answers if a.question==qid);probabilities={p.option:p.value for p in answer.probabilities};packet={'question_id':qid,'status':'available','provenance':'experimental_secondary_assessment','probabilities':probabilities};decision={'question_id':qid,'native_label':answer.selected,'accepted':accepted(answer.selected,probabilities)}
            packets.append(packet);altered.append(dict(packet,probabilities=rotate(packet['probabilities']) if packet['probabilities'] is not None else None));decisions.append(decision)
        primary={'binding':asdict(batch.binding),'cases':[{k:c[k] for k in ('id','source','node_candidate')} for c in selected]};questions=json.loads(body)['questions'];name=f'record-{index:02d}';skip=all(d['accepted'] for d in decisions)
        if skip:skipped.append(name)
        source_rows.append({'id':name,'native_request_sha256':sha(body),'native_response_sha256':None if assessment is None else assessment.response_sha256,'decisions':decisions,'cascade_skips_sdk':skip})
        for arm in ARMS:
            if arm=='cascade' and skip:continue
            advice=[] if arm in ('baseline','cascade') else packets if arm=='advice' else altered
            request={'primary_evidence':primary,'questions':questions,'secondary_assessments':advice};payload=json.dumps(request,ensure_ascii=False,separators=(',',':')).encode();path=output/arm/(name+'.json');path.write_bytes(payload)
            arm_rows[arm].append({'index':index,'id':name,'request':path.name,'request_sha256':sha(payload),'case_ids':record['case_ids'],'question_ids':record['question_ids']})
    require(inventory(native_root)==before,'native-source-changed')
    for arm in ARMS:
        save(output/arm/'plan.json',{'kind':'clef-p2-sdk-arm-v1','arm':arm,'public_sha256':sha(raw),'node_schema_sha256':sha(schema_raw),'system':schema['system_all_sdk_arms'],'system_sha256':sha(schema['system_all_sdk_arms'].encode()),'records':arm_rows[arm],'all_record_ids':[f'record-{i:02d}' for i in range(1,13)],'zero_sdk_calls_by_policy':arm=='cascade' and not arm_rows[arm],'cascade_skipped_records':skipped if arm=='cascade' else []})
    save(output/'native-source-manifest.json',before);save(output/'treatment-source.json',{'created_unix_ns':time.time_ns(),'public_sha256':sha(raw),'native_plan_sha256':sha((plan_root/'plan.json').read_bytes()),'native_root':str(native_root),'native_manifest_sha256':sha((output/'native-source-manifest.json').read_bytes()),'source_records':source_rows,'threshold_transferred_from_p1':THRESHOLD,'raw_pmax_not_calibration_guarantee':True,'rotation_order':ROTATION,'altered_advice_not_guaranteed_wrong':True,'gold_read':False,'inference':False})
    print(json.dumps({'all_case_sdk_records_each':12,'actual_cascade_sdk_records_to_invoke':len(arm_rows['cascade']),'cascade_sdk_records_skipped':len(skipped),'new_inference':False,'gold_read':False}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--plan',required=True,type=Path);p.add_argument('--native',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();build(a.plan,a.native,a.output)
