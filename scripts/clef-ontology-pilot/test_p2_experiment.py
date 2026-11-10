"""P2 proposal/treatment mechanics with owned dummy scores, no reference labels."""
from contextlib import redirect_stdout
from dataclasses import asdict
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from clef_decisions import Capture,HttpResult,Prepared,assess
from p1_experiment import task_options
import p2_experiment as experiment
import p2_treatments as treatments
from test_clef_decisions import CharacterTokenizer
from test_p1_orchestration import runtime_fixture


def setup(root):
    corpus=root/'cases.json';cases=[{'id':f'n{f:02d}-c{c:02d}','family':f'n{f:02d}','source':'Fictional attributed source.','node_candidate':'A single candidate.'} for f in range(1,7) for c in range(1,5)];corpus.write_text(json.dumps({'schema':'clef-p2-public-v1','cases':cases}));schema=root/'schema.json';schema.write_text(json.dumps({'task':'node_kind','instructions':'Classify the exact single unit.','options':[asdict(o) for o in task_options('node_kind')],'system_all_sdk_arms':'Same source-first advice-not-fact system.'}));plan=root/'plan'
    with redirect_stdout(io.StringIO()):experiment.plan(corpus,schema,plan,CharacterTokenizer())
    release=root/'release.json';release.write_text(json.dumps({'plan_sha256':experiment.sha((plan/'plan.json').read_bytes()),'gold_sealed_before_calls':True,'gold_root_model_read':False,'native_execution_ledger':str(root/'admission.json')}));return plan,release


def execute(root):
    plan,release=setup(root);native=root/'native';calls=[]
    with runtime_fixture(calls),redirect_stdout(io.StringIO()):experiment.native(plan,native,CharacterTokenizer(),release,experiment.sha(release.read_bytes()))
    return plan,native,calls

class P2Mechanics(unittest.TestCase):
    def test_isolated_entrypoints_load_colocated_modules(self):
        for name in ('p2_experiment.py','p2_treatments.py'):
            result=subprocess.run([sys.executable,'-B','-I','-S',str(Path(__file__).parent/name),'--help'],env={},capture_output=True,text=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr)
    def test_schema_and_given_proposition_only_narrow_roster(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan,release=setup(root);m=json.loads((plan/'plan.json').read_text());self.assertEqual((m['cases'],m['questions'],m['roster_records']),(24,24,12));body=json.loads((plan/'record-01.json').read_bytes());self.assertEqual(len(body['questions']),2);self.assertNotIn('reference',json.dumps(body));self.assertEqual(set(body),{'model','state','questions'})
    def test_shared_controller_closes_twelve_once(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan,native,calls=execute(root);self.assertEqual(len(calls),12);end=json.loads((native/'ended.json').read_text());self.assertEqual(end['roster_records'],list(range(1,13)));self.assertEqual(end['protocol_valid'],12)
    def test_all_accepted_cascade_has_zero_keyed_requests(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan,native,calls=execute(root);out=root/'arms'
            with redirect_stdout(io.StringIO()):treatments.build(plan,native,out)
            for arm in ('baseline','advice','altered'):self.assertEqual(len(json.loads((out/arm/'plan.json').read_text())['records']),12)
            cascade=json.loads((out/'cascade/plan.json').read_text());self.assertTrue(cascade['zero_sdk_calls_by_policy']);self.assertEqual(cascade['records'],[]);self.assertEqual(len(cascade['cascade_skipped_records']),12)
            base=json.loads((out/'baseline/record-01.json').read_text());advice=json.loads((out/'advice/record-01.json').read_text());altered=json.loads((out/'altered/record-01.json').read_text());self.assertEqual(base['primary_evidence'],advice['primary_evidence']);self.assertEqual(base['questions'],advice['questions']);self.assertEqual(base['secondary_assessments'],[]);self.assertEqual(advice['secondary_assessments'][0]['provenance'],'experimental_secondary_assessment');self.assertNotEqual(advice['secondary_assessments'],altered['secondary_assessments']);self.assertEqual(sorted(advice['secondary_assessments'][0]['probabilities'].values()),sorted(altered['secondary_assessments'][0]['probabilities'].values()))
    def test_unknown_defers_whole_sdk_record_without_repeating_native(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan,native,calls=execute(root);manifest=json.loads((plan/'plan.json').read_text());_,cases=experiment.load_cases(plan/'public-cases.json');_,schema=experiment.load_schema(plan/'question-schema.json');batch=experiment.build_batch(cases[:2],manifest['public_sha256'],1,schema);slot=native/'record-01';body=json.loads((slot/'response.bin').read_bytes());first=next(iter(body['answers']));answer=body['answers'][first];answer['choice']='unknown';answer['probabilities']={k:float(k=='unknown') for k in answer['probabilities']};raw=json.dumps(body).encode();(slot/'response.bin').write_bytes(raw);transport=json.loads((slot/'transport.json').read_text());request=(plan/'record-01.json').read_bytes();prepared=Prepared(batch,request,experiment.sha(request),manifest['records'][0]['full_input_tokens']);assessment=assess(Capture(prepared,HttpResult(200,raw,transport['elapsed_ns'],None)),batch.binding);outcome=json.loads((slot/'outcome.json').read_text());outcome['assessment']=asdict(assessment);(slot/'outcome.json').write_text(json.dumps(outcome))
            out=root/'arms'
            with redirect_stdout(io.StringIO()):treatments.build(plan,native,out)
            cascade=json.loads((out/'cascade/plan.json').read_text());self.assertEqual([r['id'] for r in cascade['records']],['record-01']);self.assertEqual(len(calls),12)
    def test_missing_completed_native_artifact_is_not_unavailability(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan,native,calls=execute(root);(native/'record-02/outcome.json').unlink()
            with self.assertRaisesRegex(ValueError,'native-closure-artifact'):treatments.build(plan,native,root/'arms')
    def test_closed_valid_capture_corruption_is_not_model_unavailability(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan,native,calls=execute(root);(native/'record-02/response.bin').write_bytes(b'not-json')
            with self.assertRaisesRegex(ValueError,'invalid-response'):treatments.build(plan,native,root/'arms')
    def test_explicit_aborted_unknown_and_unattempted_records_defer(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan,release=setup(root);native=root/'native';calls=[]
            import p1_experiment as shared
            with runtime_fixture(calls),redirect_stdout(io.StringIO()):
                base=shared.DecisionClient
                class Failure(base):
                    def invoke(self,batch,current):
                        if len(calls)==1:raise RuntimeError('owned-host-failure')
                        return super().invoke(batch,current)
                shared.DecisionClient=Failure
                with self.assertRaisesRegex(RuntimeError,'owned-host-failure'):experiment.native(plan,native,CharacterTokenizer(),release,experiment.sha(release.read_bytes()))
                treatments.build(plan,native,root/'arms')
            cascade=json.loads((root/'arms/cascade/plan.json').read_text());self.assertEqual(len(cascade['records']),11);self.assertEqual(cascade['cascade_skipped_records'],['record-01'])
    def test_rotation_is_fixed_permutation_not_truth_or_calibration(self):
        values={k:float(i==0) for i,k in enumerate(treatments.ROTATION)};rotated=treatments.rotate(values);self.assertEqual(rotated['constraint'],1.);self.assertEqual(sum(rotated.values()),1.);self.assertNotEqual(values,rotated)
    def test_changed_frozen_source_not_accepted(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan,native,calls=execute(root);(plan/'record-02.json').write_text('{}')
            with self.assertRaisesRegex(ValueError,'record-pin'):treatments.build(plan,native,root/'arms')

if __name__=='__main__':unittest.main()
