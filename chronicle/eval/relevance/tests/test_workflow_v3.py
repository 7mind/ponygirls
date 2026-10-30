"""Specified Behavioral/Blackbox-Group contracts; strict manual IO, no SQL/native/provider."""
import copy
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from workflow_v3 import (BoundFile, WorkflowManifest, IngestLimits, SetupFailure, PreparedIngest, TrustedIngestClient,
    prepare_ingest, source_fingerprints, validate_candidate_stats, validate_coverage, fixed_with_bridge,
    provision_with_client, verify_with_bridge, fingerprint, provenance, FINGERPRINT_TABLES, literal)
from workflow_cases_v3 import Case, MemoryIngest, MemoryOpener, MemoryPublication, MemoryReadBridge, MemoryFingerprint, bound_file, sha


class TrustedWorkflowContract(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.case=Case(Path(self.temp.name)); self.owner_checks=[]

    def prepared(self):
        return prepare_ingest(self.case.fixture['documents'][0],'synthetic-run',self.case.limits,self.case.receipts['a']['requestId'])

    def verify(self,store,bridge,output):
        return verify_with_bridge(store,self.case.manifest,self.case.fixture,self.case.manifest.fixture_sha256,
                                  self.case.receipts,output,self.case.rubric,bridge)

    def test_payload_roles_raw_fidelity_and_native_projection_fingerprints(self):
        prepared=self.prepared(); value=json.loads(prepared.body)
        self.assertEqual([m['role'] for m in value['messages']],['system','assistant'])
        self.assertEqual([m['recordIndex'] for m in value['messages']],[0,1])
        self.assertTrue(all(m['parentId'] is None and m['timestamp'] is None for m in value['messages']))
        self.assertIn('\x00',value['messages'][1]['text'])
        raw=value['files'][0]['content'].encode(); self.assertEqual(value['digest'],sha(raw)); self.assertEqual(value['files'][0]['sha256'],sha(raw))
        self.assertEqual(json.loads(raw.splitlines()[1])['text'],value['messages'][1]['text'])
        self.assertEqual(value['source']['collectorNamespace'],'context-eval-v3')
        self.assertEqual(value['expectedRevision'],0)
        fp=source_fingerprints(self.case.fixture['documents'][0])[1]
        archived=value['messages'][1]['text'].replace(chr(0),'\\u0000').encode()
        self.assertEqual((fp.bytes,fp.sha256,fp.role),(len(archived),sha(archived),'assistant'))

    def test_body_and_file_boundaries_are_exact_utf8_bytes(self):
        prepared=self.prepared(); raw=json.loads(prepared.body)['files'][0]['content'].encode()
        self.assertEqual(self.prepared().body,prepare_ingest(self.case.fixture['documents'][0],'synthetic-run',
            IngestLimits(len(prepared.body),len(raw),1,2),prepared.request_id).body)
        for limits in [IngestLimits(len(prepared.body)-1,4194304,1,10000),IngestLimits(8388608,len(raw)-1,1,10000),IngestLimits(8388608,4194304,1,1)]:
            with self.subTest(limits=limits), self.assertRaises(SetupFailure):
                prepare_ingest(self.case.fixture['documents'][0],'synthetic-run',limits,prepared.request_id)

    def test_giant_payload_is_separate_from_unchanged_small_bridge_guard(self):
        import bridge
        doc=copy.deepcopy(self.case.fixture['documents'][0]); doc['messages'][1]['text']='x'*2359296
        prepared=prepare_ingest(doc,'synthetic-run',self.case.limits,self.case.receipts['a']['requestId'])
        self.assertGreater(len(prepared.body),bridge.TOTAL_BYTES)
        self.assertEqual((bridge.CALL_BYTES,bridge.TOTAL_BYTES,bridge.CALL_LIMIT,bridge.TOTAL_SECONDS),(65536,1048576,64,60))

    def test_invalid_roles_paths_principals_prevent_any_ingest(self):
        for patch in [{'id':'../escape'},{'principal':'foreign'}]:
            fixture=copy.deepcopy(self.case.fixture); fixture['documents'][1].update(patch); client=MemoryIngest()
            with self.assertRaises(SetupFailure): provision_with_client(client,self.case.manifest,fixture,self.case.output('bad'+str(len(patch))+str(patch.keys())),self.case.limits)
            self.assertEqual(client.requests,[])
        for role in ('','nul\x00role',None,'x'*65):
            fixture=copy.deepcopy(self.case.fixture); fixture['documents'][1]['messages'][0]['role']=role; client=MemoryIngest()
            with tempfile.TemporaryDirectory(dir=self.case.root) as output:
                with self.assertRaises((SetupFailure,ValueError)): provision_with_client(client,self.case.manifest,fixture,Path(output),self.case.limits)
            self.assertEqual(client.requests,[])

    def test_all_credentials_are_validated_before_first_send(self):
        path=Path(self.case.owned['ingestTokenFiles']['restricted']); path.chmod(0o644); client=MemoryIngest()
        with self.assertRaises(SetupFailure): provision_with_client(client,self.case.manifest,self.case.fixture,self.case.output('auth'),self.case.limits)
        self.assertEqual(client.requests,[])

    def test_provision_records_exact_request_and_receipt_hashes_without_credentials(self):
        opener=MemoryOpener(); client=TrustedIngestClient(self.case.manifest,self.case.limits,opener,lambda owned:self.owner_checks.append(owned['pid']))
        one=copy.deepcopy(self.case.fixture); one['documents']=one['documents'][:1]
        manifest=replace(self.case.manifest,fixture=bound_file(self.case.root,'one-fixture.json',one))
        client=TrustedIngestClient(manifest,self.case.limits,opener,lambda owned:self.owner_checks.append(owned['pid']))
        output=self.case.output('ingest'); result=provision_with_client(client,manifest,one,output,self.case.limits)
        proof=json.loads((output/'a.proof.json').read_text())
        self.assertEqual(proof['requestSha256'],sha(opener.requests[0][1]))
        self.assertEqual(proof['receiptSha256'],sha(opener.last_raw))
        self.assertEqual((output/'a.receipt.json').read_bytes(),opener.last_raw)
        self.assertEqual(self.owner_checks,[123,123])
        self.assertEqual(result['a']['revision'],1)
        for path in output.iterdir():
            self.assertNotIn(b'synthetic-reader-Ingest',path.read_bytes())
            self.assertEqual(path.stat().st_mode & 0o777,0o600)

    def test_bound_config_change_and_scope_error_fail_before_http(self):
        opener=MemoryOpener(); client=TrustedIngestClient(self.case.manifest,self.case.limits,opener,lambda owned:None)
        original=self.case.manifest.native_config.path.read_bytes()
        self.case.manifest.native_config.path.write_bytes(original+b' ')
        with self.assertRaises(SetupFailure): client.submit(self.prepared())
        self.assertEqual(opener.requests,[])
        self.case.manifest.native_config.path.write_bytes(original)
        config=copy.deepcopy(self.case.config)
        next(t for t in config['staticTokens'] if t['userId']=='reader' and t['scopes']==['Ingest'])['scopes']=['Read','Ingest']
        manifest=replace(self.case.manifest,native_config=bound_file(self.case.root,'wrong-scope.json',config))
        client=TrustedIngestClient(manifest,self.case.limits,opener,lambda owned:None)
        with self.assertRaises(SetupFailure): client.submit(self.prepared())
        self.assertEqual(opener.requests,[])

    def test_ownership_failure_prevents_http_and_postcheck_runs_for_bad_receipt(self):
        opener=MemoryOpener()
        def no_owner(owned): raise SetupFailure('ownership-lost')
        with self.assertRaises(SetupFailure): TrustedIngestClient(self.case.manifest,self.case.limits,opener,no_owner).submit(self.prepared())
        self.assertEqual(opener.requests,[])
        opener.raw_reply=b'x'*4097
        with self.assertRaises(SetupFailure): TrustedIngestClient(self.case.manifest,self.case.limits,opener,lambda owned:self.owner_checks.append(1)).submit(self.prepared())
        self.assertEqual(self.owner_checks,[1,1])

    def test_publication_source_coverage_candidate_counts_and_small_probes(self):
        store=MemoryPublication(self.case); bridge=MemoryReadBridge(self.case,store); output=self.case.output('preflight')
        catalog,proof=self.verify(store,bridge,output)
        self.assertEqual(proof['candidateStats']['eligiblePieces'],1001)
        self.assertEqual(proof['candidateStats']['sessions'],1)
        self.assertEqual(len(catalog['documents']),2)
        self.assertEqual([name for name,_,_ in bridge.calls],['whoami','whoami','get_chunks','get_chunks'])
        self.assertTrue(all(args['limit']==1 and 'view' not in args for name,args,_ in bridge.calls if name=='get_chunks'))
        self.assertIn('NOT agent-observed',catalog['provenance']['sourceProofScope'])
        for statement in store.queries:
            self.assertFalse(any(word in statement.upper() for word in ('INSERT INTO','UPDATE ','DELETE FROM')))
            self.assertNotIn("snapshot->",statement)
        source_sql=next(q for q in store.queries if 'workflow-v3:source:' in q)
        self.assertIn("sha256(convert_to(value->>'text','UTF8'))",source_sql)
        self.assertNotIn("'text',value",source_sql)
        candidate=next(q for q in store.queries if 'workflow-v3:candidates' in q)
        for term in ('vector_dims','vector_norm','ch_problem_pieces','ch_members','s.published=sc.generation',"metadata->>'project'"):
            self.assertIn(term,candidate)

    def test_source_role_hash_or_position_mismatch_is_setup_failure(self):
        for key,value in [('role','user'),('sha256','f'*64),('position',99),('recordIndex',99),('valueId','wrong')]:
            store=MemoryPublication(self.case); sid=self.case.receipts['a']['sessionId']; store.messages[sid][1][key]=value
            with tempfile.TemporaryDirectory(dir=self.case.root) as output, self.assertRaises(SetupFailure): self.verify(store,MemoryReadBridge(self.case,store),Path(output))

    def test_required_ranges_and_context_negative_fail_closed(self):
        for defect in ('problem-hole','Context-indexed','wrong-position'):
            store=MemoryPublication(self.case); sid=self.case.receipts['a']['sessionId']
            if defect=='problem-hole': store.spans[sid]=[s for s in store.spans[sid] if s['kind']!='problem']
            if defect=='Context-indexed': store.spans[sid].append({'kind':'search','messageId':'bootstrap','messagePosition':0,'start':0,'end':1})
            if defect=='wrong-position': store.spans[sid][1]['messagePosition']=0
            with tempfile.TemporaryDirectory(dir=self.case.root) as output, self.assertRaises(SetupFailure): self.verify(store,MemoryReadBridge(self.case,store),Path(output))

    def test_adjacent_piece_and_passage_ranges_merge_but_gaps_do_not(self):
        doc={'id':'d','messages':[{'id':'m','text':'abcdef'}],'expectedProblem':['m'],'expectedContext':[]}
        spans=[{'kind':kind,'messageId':'m','messagePosition':0,'start':start,'end':end} for kind in ('problem','chunk','search') for start,end in [(0,2),(2,6)]]
        self.assertEqual(validate_coverage(doc,[{'messageId':'m','start':0,'end':6}],spans)['requiredRanges'],1)
        spans[-1]['start']=3
        with self.assertRaises(SetupFailure): validate_coverage(doc,[{'messageId':'m','start':0,'end':6}],spans)

    def test_at_most_1000_pieces_bad_vector_or_bad_links_fail_setup(self):
        for defect in ('1000','zero','wrong-dimensions','bad-link'):
            store=MemoryPublication(self.case)
            if defect=='1000': store.pieces.pop(0)
            if defect=='zero': store.pieces[0]['vector']=[0.0,0.0]
            if defect=='wrong-dimensions': store.pieces[0]['vector']=[1.0]
            if defect=='bad-link': store.pieces[0]['badLink']=True
            with tempfile.TemporaryDirectory(dir=self.case.root) as output, self.assertRaises(SetupFailure): self.verify(store,MemoryReadBridge(self.case,store),Path(output))

    def test_profile_retirement_project_receipt_and_progress_checks(self):
        for key,value in [('retired',True),('owner','restricted'),('project','foreign'),('receiptMatches',False),('jobState','Running'),('completedWindows',0),('profile','unknown')]:
            store=MemoryPublication(self.case); store.metadata[self.case.receipts['a']['sessionId']][key]=value
            with tempfile.TemporaryDirectory(dir=self.case.root) as output, self.assertRaises(SetupFailure): self.verify(store,MemoryReadBridge(self.case,store),Path(output))

    def test_fixed_baseline_uses_actual_mode_query_and_never_reads_messages(self):
        store=MemoryPublication(self.case); bridge=MemoryReadBridge(self.case,store); task=self.case.fixture['tasks'][0]
        catalog={'fixtureSha256':self.case.manifest.fixture_sha256,'provenance':provenance(self.case.manifest)}
        wrapper=fixed_with_bridge(bridge,self.case.manifest,self.case.fixture,task,'lexical',catalog,self.case.output('fixed'))
        self.assertEqual(bridge.calls,[('search_sessions',wrapper['request'],'reader')])
        self.assertEqual(wrapper['request'],{'query':'approved port','mode':'lexical','limit':5,'offset':0,'project':'relevance-synthetic-run'})
        self.assertNotIn('facts',json.loads((self.case.root/'fixed/request.json').read_text()))
        self.assertEqual(json.loads((self.case.root/'fixed/retrieval.json').read_text()),wrapper['result'])
        missing=copy.deepcopy(self.case.fixture); missing['tasks'][0]['fixedQueries'].pop('lexical')
        missing_manifest=replace(self.case.manifest,fixture=bound_file(self.case.root,'missing-query-fixture.json',missing))
        missing_catalog=dict(catalog,fixtureSha256=missing_manifest.fixture_sha256)
        with self.assertRaises(SetupFailure): fixed_with_bridge(bridge,missing_manifest,missing,missing['tasks'][0],'lexical',missing_catalog,self.case.output('missing-query'))

    def test_fingerprint_same16_scope_and_selected_jobs_columns(self):
        sql=MemoryFingerprint(); before=fingerprint(sql)
        self.assertEqual(before['policy'],'digest-state-v3'); self.assertEqual(len(before['tables']),16)
        self.assertEqual(set(before),{'policy','tables','sha256'})
        sql.rows['jobs']=[{'id':'j','session_id':'s','revision':1,'profile':'p','state':'Complete','run_id':'r','lease_until':'now','attempts':2}]
        changed=fingerprint(sql); self.assertNotEqual(before['sha256'],changed['sha256'])
        sql.rows['jobs'][0].update(lease_until='later',attempts=3)
        self.assertEqual(changed['sha256'],fingerprint(sql)['sha256'])
        sql.rows['jobs'][0]['run_id']='new-run'
        self.assertNotEqual(changed['sha256'],fingerprint(sql)['sha256'])
        statement=sql.statements[0]
        self.assertIn("sha256(convert_to(row_to_json(t)::text,'UTF8'))",statement)
        self.assertIn('SELECT id,session_id,revision,profile,state,run_id FROM ch_jobs',statement)
        self.assertNotIn('json_agg',statement)
        self.assertNotIn('ch_index_checkpoints',statement)

    def test_fingerprint_row_order_hash_determinism_and_state_binding(self):
        sql=MemoryFingerprint(); sql.rows['sources']=[{'id':'b','published':'x'},{'id':'a','published':'y'}]
        first=fingerprint(sql); sql.rows['sources'].reverse(); self.assertEqual(first,fingerprint(sql))
        sql.rows['sources'][0]['published']='z'; self.assertNotEqual(first['sha256'],fingerprint(sql)['sha256'])
        self.assertTrue(all(set(v)=={'table','count','sha256'} for v in first['tables'].values()))

    def test_sql_literal_values_cannot_inject_statements(self):
        self.assertEqual(literal("a'b"),"'a''b'")
        with self.assertRaises(SetupFailure): literal('nul\x00value')

    def test_fixture_object_mutation_cannot_keep_original_raw_binding(self):
        changed=copy.deepcopy(self.case.fixture); changed['documents'][0]['messages'][1]['text']+=' changed'
        client=MemoryIngest()
        with self.assertRaises(SetupFailure):
            provision_with_client(client,self.case.manifest,changed,self.case.output('mutated-fixture'),self.case.limits)
        self.assertEqual(client.requests,[])

    def test_public_provision_prerequisite_failure_has_retained_attempt(self):
        from workflow_v3 import provision_documents
        fixture=copy.deepcopy(self.case.fixture); fixture['documents'][0]['messages'][0]['role']=''
        # Make the invalid payload the bound input: this tests payload validation, not a hash mismatch.
        binding=bound_file(self.case.root,'invalid-fixture.json',fixture)
        manifest=replace(self.case.manifest,fixture=binding)
        output=self.case.output('prerequisite-failure')
        with self.assertRaises(SetupFailure): provision_documents(manifest,fixture,output,self.case.limits)
        self.assertTrue((output/'setup-failure.json').exists())
        self.assertTrue((output/'attempt.json').exists())

    def test_missing_accepted_embedding_work_cannot_claim_genuine_publication(self):
        store=MemoryPublication(self.case)
        def annotation_only(statement):
            raw=store(statement)
            if 'workflow-v3:checkpoints:' in statement:
                return json.dumps([row for row in json.loads(raw) if row['stage']=='Annotation'])
            return raw
        with self.assertRaises(SetupFailure): self.verify(annotation_only,MemoryReadBridge(self.case,store),self.case.output('no-embedding'))

    def test_rubric_cannot_silently_drop_unknown_required_document(self):
        store=MemoryPublication(self.case); rubric=copy.deepcopy(self.case.rubric)
        for key in ('anchorsAny','qualifiersAll'): rubric['tasks']['q']['propositions'][0][key][0]['document']='unknown'
        with self.assertRaises(SetupFailure):
            verify_with_bridge(store,self.case.manifest,self.case.fixture,self.case.manifest.fixture_sha256,
                self.case.receipts,self.case.output('bad-rubric'),rubric,MemoryReadBridge(self.case,store))


    def test_wrong_read_scope_identity_or_public_source_bytes_fail_preflight(self):
        for defect in ('scope','identity','literal'):
            store=MemoryPublication(self.case); bridge=MemoryReadBridge(self.case,store)
            if defect=='scope': bridge.identities['reader']['scopes']=['Read','Raw']
            if defect=='identity': bridge.identities['reader']['id']='restricted'
            if defect=='literal': store.pieces[0]['text']='falsified source'
            with tempfile.TemporaryDirectory(dir=self.case.root) as output, self.assertRaises(ValueError): self.verify(store,bridge,Path(output))

    def test_http_credential_is_reread_for_each_bounded_submission(self):
        expected=['synthetic-reader-Ingest']
        class FreshCredentialOpener(MemoryOpener):
            def open(inner,request,timeout):
                if request.get_header('Authorization') != 'Bearer '+expected[0]: raise AssertionError('credential was not refreshed')
                return super().open(request,timeout)
        opener=FreshCredentialOpener(); client=TrustedIngestClient(self.case.manifest,self.case.limits,opener,lambda owned:None)
        client.submit(self.prepared()); expected[0]='changed-synthetic-credential'
        Path(self.case.owned['ingestTokenFiles']['reader']).write_text(expected[0]); client.submit(self.prepared())
        self.assertEqual(len(opener.requests),2)
        self.assertTrue(all(call[0].endswith('/api/ingest') and call[2]==30 for call in opener.requests))

    def test_fixture_semantics_ignore_object_order_but_keep_raw_digest(self):
        reordered={k:self.case.fixture[k] for k in reversed(self.case.fixture)}
        self.case.manifest.verify_fixture(reordered)
        self.assertEqual(self.case.manifest.fixture_sha256,sha(self.case.manifest.fixture.path.read_bytes()))
        self.assertNotEqual(self.case.manifest.fixture_sha256,sha(json.dumps(reordered).encode()))

    def test_fingerprint_scope_matches_actual_unchanged_legacy_function(self):
        import ast
        tree=ast.parse((Path(__file__).resolve().parents[1]/'run_real.py').read_text())
        function=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='fingerprint')
        assignment=next(node for node in function.body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='tables' for t in node.targets))
        legacy=ast.literal_eval(assignment.value)
        self.assertEqual({table.label:(table.table,table.order) for table in FINGERPRINT_TABLES},legacy)
        self.assertEqual(next(table.columns for table in FINGERPRINT_TABLES if table.label=='jobs'),'id,session_id,revision,profile,state,run_id')
