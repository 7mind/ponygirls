"""P1 plan contracts using synthetic shape-only inputs, not authored benchmark gold."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from clef_decisions import Limits, prepare
from p1_experiment import GENERIC, build_batch, load_cases, native, plan
from test_clef_decisions import CharacterTokenizer


def synthetic_cases():
    cases=[]
    for family in range(1,19):
        partition='development' if family<=6 else 'calibration' if family<=12 else 'test'
        for index in range(1,5):
            cases.append({'id':f'f{family:02d}-c{index:02d}','family':f'f{family:02d}','partition':partition,'source':'synthetic shape-only source','node_candidate':'unit','edge_source':'left','edge_target':'right','claim':'claim'})
    return {'schema':'clef-p1-public-v1','cases':cases}


class PublicPlanTests(unittest.TestCase):
    def test_complete_roster_and_matching_llm_payload(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'cases.json';raw=json.dumps(synthetic_cases()).encode();source.write_bytes(raw);out=root/'plan'
            plan(source,out,CharacterTokenizer())
            manifest=json.loads((out/'plan.json').read_text());self.assertEqual(manifest['cases'],72);self.assertEqual(manifest['questions'],216);self.assertEqual(len(manifest['records']),36)
            self.assertEqual(manifest['public_sha256'],hashlib.sha256(raw).hexdigest())
            seen=[]
            for record in manifest['records']:
                body=(out/record['request']).read_bytes();request=json.loads(body);seen.extend(record['question_ids'])
                self.assertEqual(hashlib.sha256(body).hexdigest(),record['request_sha256'])
                self.assertEqual((out/f'record-{record["index"]:02d}.llm.txt').read_text(),GENERIC+'\n\n'+body.decode())
                self.assertEqual(set(request['questions']),set(record['question_ids']))
                # Partition/family are evaluator grouping, not model-visible hints.
                state=json.loads(request['state']);self.assertEqual(set(state),{'binding','evidence'})
                for case in json.loads(state['evidence'])['cases']:
                    self.assertNotIn('partition',case);self.assertNotIn('family',case)
            self.assertEqual(len(set(seen)),216)
            with self.assertRaises(FileExistsError):plan(source,out,CharacterTokenizer())

    def test_public_gold_field_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'cases.json';value=synthetic_cases();value['cases'][0]['expected']='hidden';source.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,'public-corpus-fields'):load_cases(source)

    def test_missing_case_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'cases.json';value=synthetic_cases();value['cases'].pop();source.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,'public-corpus-size'):load_cases(source)

    def test_duplicate_case_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'cases.json';value=synthetic_cases();value['cases'][1]['id']=value['cases'][0]['id'];source.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,'duplicate-case'):load_cases(source)

    def test_partition_cannot_be_silently_reassigned(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'cases.json';value=synthetic_cases();value['cases'][0]['partition']='test';source.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,'partition-binding'):load_cases(source)

    def test_candidates_and_three_tasks_binding(self):
        cases=synthetic_cases()['cases'][:2];batch=build_batch(cases,'a'*64,1)
        self.assertEqual(len(batch.questions),6);self.assertEqual(len({q.id for q in batch.questions}),6)
        self.assertEqual(batch.binding.source_sha256,hashlib.sha256(batch.evidence.encode()).hexdigest())
        request=prepare(batch,CharacterTokenizer(),Limits(8192,180.,1048576),batch.binding)
        self.assertEqual(json.loads(request.body)['model'],'Cloudflare/clef')

    def test_release_fails_before_runtime_import_network_or_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan_root=root/'plan';plan_root.mkdir();(plan_root/'plan.json').write_text('{}');release=root/'release.json';release.write_text(json.dumps({'plan_sha256':'wrong','gold_sealed_before_calls':True,'gold_root_model_read':False}));out=root/'out'
            with self.assertRaisesRegex(ValueError,'release-gate'):native(plan_root,out,CharacterTokenizer(),release,hashlib.sha256(release.read_bytes()).hexdigest())
            self.assertFalse(out.exists())

if __name__=='__main__':unittest.main()
