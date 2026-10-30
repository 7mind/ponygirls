"""Specified Behavioral-Active Blackbox-Group runner binding/dispatch contracts."""
import ast
import copy
import hashlib
import json
import re
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runner_integration_v3 as integration
import run_real
from v3_cases import cell


def binding():
    return {'sourcePolicy': 'archived-bridge-v1', 'fingerprintPolicy': 'full-state-v1',
            'protocolPolicy': 'evidence-navigation-v3', 'catalogVariant': 'baseline',
            'executorCodecs': {'project': '/declared/project', 'files': [
                {'relativePath': 'generated/typescript/current.ts', 'sha256': 'a' * 64}]},
            'rubric': {'path': '/declared/rubric.json', 'sha256': 'b' * 64}, 'batch': None}


def bind_file(path, value):
    path.write_text(json.dumps(value))
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


class RunnerIntegrationContracts(unittest.TestCase):
    def test_required_closed_policy_pair_and_phase(self):
        value = binding()
        policy = integration.WorkflowBinding.parse(value, 'prepare')
        self.assertEqual(policy.source_policy, 'archived-bridge-v1')
        for missing in value:
            bad = copy.deepcopy(value); del bad[missing]
            with self.subTest(missing=missing), self.assertRaises(ValueError):
                integration.WorkflowBinding.parse(bad, 'prepare')
        mutations = [dict(value, extra=True), dict(value, sourcePolicy='other'),
                     dict(value, fingerprintPolicy='digest-state-v3'), dict(value, protocolPolicy='old'),
                     dict(value, catalogVariant='arbitrary'), dict(value, batch={}),
                     dict(value, executorCodecs={'project':'/p','files':[],'fallback':True})]
        for bad in mutations:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                integration.WorkflowBinding.parse(bad, 'prepare')
        with self.assertRaises(ValueError):
            integration.WorkflowBinding.parse(value, 'run')
        trusted = dict(value, sourcePolicy='trusted-workflow-v3', fingerprintPolicy='digest-state-v3', catalogVariant='context')
        self.assertEqual(integration.WorkflowBinding.parse(trusted, 'prepare').fingerprint_policy, 'digest-state-v3')

    def test_exact_executor_codec_set_and_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root/'generated/typescript/current.ts'
            source.parent.mkdir(parents=True); source.write_text('current codecs')
            files = [{'relativePath':'generated/typescript/current.ts','sha256':hashlib.sha256(source.read_bytes()).hexdigest()}]
            integration.validate_codec_files(root, files)
            for bad in ([], files*2, [dict(files[0], sha256='0'*64)],
                        [dict(files[0],relativePath='../escape.ts')]):
                with self.subTest(files=bad), self.assertRaises(ValueError):
                    integration.validate_codec_files(root, bad)
            (source.parent/'unbound.ts').write_text('extra import')
            with self.assertRaises(ValueError):
                integration.validate_codec_files(root, files)

    def test_fresh_prepare_codec_agreement_uses_bytes_not_absolute_project_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); files=[]
            for name in ('publisher','executor'):
                source=root/name/'generated/typescript/current.ts'; source.parent.mkdir(parents=True)
                source.write_text('identical current codecs')
                files=[{'relativePath':'generated/typescript/current.ts','sha256':hashlib.sha256(source.read_bytes()).hexdigest()}]
            value=binding(); value['executorCodecs']={'project':str(root/'executor'),'files':files}
            inputs={'workflow':value,'agentReasoningPolicy':'max','agentMaximumOutputTokens':65536,
                    'generatedProject':str(root/'publisher'),'generatedFiles':files}
            integration.validate_workflow_bindings(inputs,'prepare')
            for bad in (dict(inputs,generatedFiles=[]),dict(inputs,agentReasoningPolicy='high'),
                        dict(inputs,agentMaximumOutputTokens=True),dict(inputs,workflow=None)):
                with self.subTest(inputs=bad),self.assertRaises(ValueError):
                    integration.validate_workflow_bindings(bad,'prepare')

    def test_freeze_covers_transitive_local_runtime_imports_and_independent_executor_codecs(self):
        root=Path(run_real.__file__).parent
        local=set(); pending=[root/'run_real.py',root/'agent_probe.mjs',root/'resolve-live-generated.mjs']
        while pending:
            path=pending.pop()
            if path in local:
                continue
            local.add(path); source=path.read_text()
            if path.suffix=='.py':
                for node in ast.walk(ast.parse(source)):
                    names=([node.module] if isinstance(node,ast.ImportFrom) else [a.name for a in node.names] if isinstance(node,ast.Import) else [])
                    pending.extend(root/(name+'.py') for name in names if name and (root/(name+'.py')).is_file())
            else:
                pending.extend((root/name).resolve() for name in re.findall(r"from ['\"](\./[^'\"]+)['\"]",source))
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp); executor=directory/'executor'; codec=executor/'generated/typescript/current.ts'
            codec.parent.mkdir(parents=True); codec.write_text('independent executor')
            files=[{'relativePath':'generated/typescript/current.ts','sha256':hashlib.sha256(codec.read_bytes()).hexdigest()}]
            metadata={name:bind_file(directory/(name+'.json'),{}) for name in ('fixture','configTemplate','embeddingProof','annotation','embedding','rubric')}
            runtime=bind_file(directory/'external-runtime.mjs',{'runtime':'bound'})
            value=binding(); value['executorCodecs']={'project':str(executor),'files':files}; value['rubric']=metadata['rubric']
            inputs={key:metadata[key] for key in ('fixture','configTemplate','embeddingProof')}
            inputs.update(workflow=value,annotation={'profile':metadata['annotation']},embedding={'profile':metadata['embedding']},
                          generatedProject='/immutable-unavailable-publisher',generatedFiles=['original-seed-declaration'],runtimeFiles=[runtime],playwright=runtime)
            inputs['frozenInputs']=[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(local)]+list(metadata.values())+[runtime]
            output=directory/'out'; output.mkdir(); workflow,project=run_real.freeze(inputs,output)
            self.assertTrue(all((workflow/p.name).read_bytes()==p.read_bytes() for p in local))
            self.assertEqual((project/'generated/typescript/current.ts').read_bytes(),codec.read_bytes())
            self.assertFalse((project/'immutable-unavailable-publisher').exists())
            missing=copy.deepcopy(inputs); missing['frozenInputs']=[item for item in missing['frozenInputs'] if item['path']!=str(root/'source_observations_v3.py')]
            other=directory/'missing'; other.mkdir()
            with self.assertRaisesRegex(ValueError,'frozenInputs'):
                run_real.freeze(missing,other)

    def test_v3_sidecar_preserves_strict_metrics_and_leaves_review_unavailable(self):
        inputs=cell()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            paths={}
            for name in ('fixture','catalog','rubric','configuration','mapping','schedule','controller','fixed_retrieval','run','native_outcome','outcome','trace','answer'):
                artifact=getattr(inputs,name)
                target=root/({'configuration':'input.json','mapping':'map.json','fixed_retrieval':'fixed.json','native_outcome':'native-outcome.json','trace':'trace.jsonl'}.get(name,name+'.json'))
                target.write_bytes(artifact.raw); paths[name]=target
            (root/'score.json').write_text('{"answerSuccess":true,"assessmentScope":"historical-format"}')
            before={p.name:p.read_bytes() for p in root.iterdir()}
            run_real.write_v3_sidecar(root,inputs.task_id,inputs.opaque_id,*[paths[name] for name in
                ('fixture','catalog','rubric','configuration','mapping','schedule','controller','fixed_retrieval')])
            result=json.loads((root/'assessment-v3.json').read_text())
            self.assertFalse(result['review']['available']); self.assertIsNone(result['review']['factualCorrect'])
            self.assertTrue(result['legacyMetrics']['answerSuccess']); self.assertFalse(result['groundedAnswerSuccessV3'])
            for name,raw in before.items():
                self.assertEqual((root/name).read_bytes(),raw)

    def test_historical_seed_requires_explicit_matching_legacy_policy(self):
        old = integration.WorkflowBinding.parse(binding(), 'prepare')
        labelled = integration.validate_seed_policy({}, {}, old)
        self.assertEqual(labelled, {'fingerprintPolicy':'full-state-v1','sourcePolicy':'archived-bridge-v1','evidenceFormat':'historical-unlabelled-seed'})
        trusted = integration.WorkflowBinding.parse(dict(binding(), sourcePolicy='trusted-workflow-v3',fingerprintPolicy='digest-state-v3'), 'prepare')
        for proof, prior, policy in (({}, {}, trusted), ({'fingerprintPolicy':'digest-state-v3'}, {}, old),
                                     ({'fingerprintPolicy':'full-state-v1'}, {'workflow':dict(binding(),sourcePolicy='trusted-workflow-v3')}, old)):
            with self.subTest(proof=proof), self.assertRaises(ValueError):
                integration.validate_seed_policy(proof, prior, policy)
        fresh = integration.validate_seed_policy({'fingerprintPolicy':'digest-state-v3','sourcePolicy':'trusted-workflow-v3'}, {'workflow':dict(binding(),sourcePolicy='trusted-workflow-v3',fingerprintPolicy='digest-state-v3')}, trusted)
        self.assertEqual(fresh['evidenceFormat'], 'policy-labelled-seed')

    def test_seed_policy_mismatch_stops_offline_clone_before_any_data_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); seed=root/'seed'; seed.mkdir(); (seed/'data').mkdir(); (seed/'data/PG_VERSION').write_text('18')
            native=bind_file(root/'publisher',{'publisher':'bound'})
            keys=('postgres','fixture','annotation','embedding','factFormat','agentModel','generatedFiles','generatedProject','configTemplate')
            prior={key:'same immutable publisher declaration' for key in keys}; prior['native']=native
            bind_file(seed/'bindings.json',prior)
            proof={'status':'Prepared','preparedFiles':{'bindings.json':hashlib.sha256((seed/'bindings.json').read_bytes()).hexdigest()},
                   'dataFiles':run_real.data_inventory(seed/'data')}
            bind_file(seed/'prepared.json',proof); bind_file(seed/'cleanup.json',{'ownedChildrenReaped':True,'cleanupErrors':[]})
            value=binding(); value.update(sourcePolicy='trusted-workflow-v3',fingerprintPolicy='digest-state-v3')
            value['batch']={'batchId':'b','arm':'a','repeat':1,'schedule':{'path':'/master','sha256':'c'*64}}
            inputs=dict(prior,preparedNative=native,workflow=value)
            output=root/'out'; output.mkdir()
            with self.assertRaisesRegex(ValueError,'unlabelled seed'):
                run_real.clone_prepared(seed,output,inputs)
            self.assertFalse((output/'data').exists())
            self.assertEqual((seed/'data/PG_VERSION').read_text(),'18')

    def test_v3_missing_controller_artifacts_are_explicitly_unavailable_not_fabricated(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); missing=root/'missing'
            run_real.write_v3_sidecar(root,'actual','opaque',*[missing]*8)
            result=json.loads((root/'assessment-v3.json').read_text())
            self.assertFalse(result['available']); self.assertIn('run',result['missingArtifacts'])
            self.assertEqual({p.name for p in root.iterdir()},{'assessment-v3.json'})

    def test_master_schedule_exact_identity_order_and_selection(self):
        with tempfile.TemporaryDirectory() as temp:
            rows = [{'batchId':'batch-a','arm':'candidate','repeat':2,'mode':mode,'taskId':'t','ordinal':ordinal}
                    for ordinal,mode in enumerate(('semantic','lexical'))]
            rows.insert(0, dict(rows[0],arm='baseline',ordinal=40))
            value = binding(); value['batch'] = {'batchId':'batch-a','arm':'candidate','repeat':2,
                'schedule':bind_file(Path(temp)/'schedule.json', {'trials':rows})}
            policy = integration.WorkflowBinding.parse(value, 'run')
            fixture = {'tasks':[{'id':'t','split':'dev'}]}
            actual = integration.bound_schedule(policy,fixture,['lexical','semantic'],'dev')
            self.assertEqual(actual,rows[1:])
            for malformed in (rows[1:]+[rows[1]], [dict(rows[1],extra=True),rows[2]],
                              [rows[1]], [dict(rows[1],repeat=True),rows[2]], [dict(rows[1],ordinal=-1),rows[2]]):
                value['batch']['schedule'] = bind_file(Path(temp)/'schedule.json',{'trials':malformed})
                bad = integration.WorkflowBinding.parse(value,'run')
                with self.subTest(rows=malformed), self.assertRaises(ValueError):
                    integration.bound_schedule(bad,fixture,['lexical','semantic'],'dev')

    def test_legacy_fingerprint_is_only_labelled_not_recomputed(self):
        old = integration.WorkflowBinding.parse(binding(),'prepare')
        result = {'sha256':'original-byte-canonical-hash','state':{'jobs':['original-six-columns']}}
        marker = object()
        def legacy(sql):
            self.assertIs(sql,marker)
            return result
        observed = integration.publication_fingerprint(old,marker,legacy)
        self.assertEqual(observed['sha256'],result['sha256'])
        self.assertEqual(observed['state'],result['state'])
        self.assertEqual(observed['policy'],'full-state-v1')
        self.assertNotIn('policy',result)

    def test_setup_rejection_is_not_agent_start_or_fixed_retrieval(self):
        class RejectedPublication:
            def verify_publication(self, sql, manifest, fixture, fixture_sha, receipts, output, rubric):
                self.seen_sql = sql
                raise ValueError('fewer-than-1001-eligible-Problem-pieces')
        class Manifest:
            fixture_sha256 = 'declared-fixture'
        backend = RejectedPublication(); sql = object()
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)/'preflight'; directory.mkdir()
            with self.assertRaisesRegex(ValueError,'fewer-than-1001'):
                integration.trusted_preflight(backend,sql,Manifest(),{}, {},directory,{})
            self.assertIs(backend.seen_sql,sql)
            self.assertFalse((directory/'catalog.json').exists())


if __name__ == '__main__':
    unittest.main()
