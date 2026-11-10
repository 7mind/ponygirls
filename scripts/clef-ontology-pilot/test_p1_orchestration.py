"""Owned orchestration reproduction: no native model, metadata queries or network."""
from contextlib import contextmanager, redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest

import p1_experiment as experiment
from clef_decisions import (Binding, Capture, DecisionBatch, HttpResult, Option, Question,
                            pieces, prepare)
from test_clef_decisions import CharacterTokenizer
from test_p1_experiment import synthetic_cases

@contextmanager
def runtime_fixture(calls):
    names=('sglang','sglang.srt','sglang.srt.entrypoints','sglang.srt.entrypoints.systemone','sglang.srt.entrypoints.systemone.protocol','sglang.srt.entrypoints.systemone.joint_schema')
    saved={name:sys.modules.get(name) for name in names}
    saved_metadata,saved_client=experiment.metadata,experiment.DecisionClient
    for name in names:
        module=types.ModuleType(name);module.__path__=[];sys.modules[name]=module
    class Request:
        model_validate=staticmethod(lambda value:value)
    def encode(tokenizer,request,max_length,image_token_counts):
        state=json.loads(request['state']);binding=Binding(**state['binding'])
        questions=tuple(Question(key,q['instructions'],tuple(Option(k,v) for k,v in q['criteria'].items())) for key,q in request['questions'].items())
        batch=DecisionBatch(binding,state['evidence'],questions)
        return [token for piece in pieces(batch) for token in tokenizer.encode(piece,add_special_tokens=False)],[]
    class Client:
        def __init__(self,transport,tokenizer,limits):self.tokenizer,self.limits=tokenizer,limits
        def invoke(self,batch,current):
            calls.append(batch.binding.frontier)
            prepared=prepare(batch,self.tokenizer,self.limits,current);answers={}
            for q in batch.questions:
                answers[q.id]={'type':'choice','choice':q.options[0].id,'confidence':1.,'probabilities':{o.id:1. if o==q.options[0] else 0. for o in q.options}}
            body=json.dumps({'model':'Cloudflare/clef','answers':answers,'usage':{'input_tokens':prepared.untruncated_input_tokens,'output_tokens':0}}).encode()
            return Capture(prepared,HttpResult(200,body,1,None))
    sys.modules[names[-2]].SystemOneRequest=Request
    sys.modules[names[-1]].encode_joint_schema=encode
    experiment.metadata=lambda:({'service':{'MainPID':'owned-dummy'}},Path('/unused-dummy-model'))
    experiment.DecisionClient=Client
    try:yield
    finally:
        experiment.metadata,experiment.DecisionClient=saved_metadata,saved_client
        for name,value in saved.items():
            if value is None:sys.modules.pop(name,None)
            else:sys.modules[name]=value


def setup(root):
    corpus=root/'public.json';corpus.write_text(json.dumps(synthetic_cases()));plan_root=root/'plan'
    with redirect_stdout(io.StringIO()):experiment.plan(corpus,plan_root,CharacterTokenizer())
    release=root/'release.json';release.write_text(json.dumps({'plan_sha256':hashlib.sha256((plan_root/'plan.json').read_bytes()).hexdigest(),'gold_sealed_before_calls':True,'gold_root_model_read':False,'native_execution_ledger':str(root/'native-admission.json')}))
    return plan_root,release


class NativeOrchestrationReproductions(unittest.TestCase):
    def test_same_release_cannot_be_reissued_with_new_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan_root,release=setup(root);calls=[]
            with runtime_fixture(calls),redirect_stdout(io.StringIO()):
                experiment.native(plan_root,root/'first',CharacterTokenizer(),release,hashlib.sha256(release.read_bytes()).hexdigest())
                with self.assertRaisesRegex(ValueError,'release-already-consumed'):
                    experiment.native(plan_root,root/'second',CharacterTokenizer(),release,hashlib.sha256(release.read_bytes()).hexdigest())
            self.assertEqual(len(calls),36)

    def test_later_correspondence_failure_is_preflighted_and_roster_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan_root,release=setup(root);(plan_root/'record-02.json').write_bytes(b'changed-after-plan');calls=[];out=root/'out'
            with runtime_fixture(calls),redirect_stdout(io.StringIO()):
                with self.assertRaises(ValueError):experiment.native(plan_root,out,CharacterTokenizer(),release,hashlib.sha256(release.read_bytes()).hexdigest())
            self.assertEqual(calls,[],'All frozen records must be checked before the first measured send')
            ended=json.loads((out/'ended.json').read_text());self.assertEqual(ended['status'],'aborted');self.assertEqual(ended['invocation_started_records'],[]);self.assertEqual(len(ended['unattempted_records']),36)

    def test_existing_output_is_rejected_before_consuming_release(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan_root,release=setup(root);calls=[];out=root/'existing';out.mkdir();marker=out/'user-file';marker.write_text('preserve')
            with runtime_fixture(calls),redirect_stdout(io.StringIO()):
                with self.assertRaises((FileExistsError,ValueError)):
                    experiment.native(plan_root,out,CharacterTokenizer(),release,hashlib.sha256(release.read_bytes()).hexdigest())
            self.assertEqual(calls,[])
            self.assertFalse((root/'native-admission.json').exists(),'Preexisting user output must not consume a release')
            self.assertEqual(marker.read_text(),'preserve')
            self.assertEqual({p.name for p in out.iterdir()},{'user-file'})

    def test_post_claim_output_initialization_fault_closes_zero_call_attempt(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan_root,release=setup(root);calls=[]
            class UncreatableOutput:
                def exists(self):return False
                def is_symlink(self):return False
                def mkdir(self,**kwargs):raise OSError('owned-initialization-fault')
                def __str__(self):return 'owned-uncreatable-output'
            with runtime_fixture(calls):
                with self.assertRaisesRegex(OSError,'owned-initialization-fault'):
                    experiment.native(plan_root,UncreatableOutput(),CharacterTokenizer(),release,hashlib.sha256(release.read_bytes()).hexdigest())
            self.assertEqual(calls,[]);ended=json.loads((root/'native-admission.json.closed.json').read_text());self.assertEqual(ended['status'],'aborted');self.assertEqual(ended['failure_stage'],'output-initialization');self.assertFalse(ended['output_created_by_this_attempt']);self.assertEqual(len(ended['unattempted_records']),36)

    def test_host_exception_retains_started_unknown_and_unattempted_records(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);plan_root,release=setup(root);calls=[];out=root/'out'
            with runtime_fixture(calls),redirect_stdout(io.StringIO()):
                base=experiment.DecisionClient
                class FailingClient(base):
                    def invoke(self,batch,current):
                        if len(calls)==1:raise RuntimeError('owned-host-fault')
                        return super().invoke(batch,current)
                experiment.DecisionClient=FailingClient
                with self.assertRaisesRegex(RuntimeError,'owned-host-fault'):
                    experiment.native(plan_root,out,CharacterTokenizer(),release,hashlib.sha256(release.read_bytes()).hexdigest())
            ended=json.loads((out/'ended.json').read_text());self.assertEqual(ended['status'],'aborted');self.assertEqual(ended['invocation_started_records'],[1,2]);self.assertEqual(ended['outcome_records'],[1]);self.assertEqual(ended['started_without_outcome_records'],[2]);self.assertEqual(len(ended['unattempted_records']),34)
            self.assertTrue((root/'native-admission.json.closed.json').is_file())
            with runtime_fixture([]):
                with self.assertRaisesRegex(ValueError,'release-already-consumed'):
                    experiment.native(plan_root,root/'retry',CharacterTokenizer(),release,hashlib.sha256(release.read_bytes()).hexdigest())

if __name__=='__main__':unittest.main()
