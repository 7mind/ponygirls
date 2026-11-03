#!/usr/bin/env python3
"""Behavioral-Active / Blackbox-Atomic and controlled-process regression tests.
No systemd, VM, PG, model or production process is selected or contacted.
Actual adapter readiness boundary/actual driver functions are exercised.
"""
import ast,datetime,importlib.util,json,os,pathlib,select,signal,subprocess,sys,tempfile,time,types,unittest
ROOT=pathlib.Path(os.environ.get('UNIT_GRAPH_TEST_SOURCE_DIR',pathlib.Path(__file__).parent))

def functions():
    tree=ast.parse((ROOT/'service-unit-graph-vm.py').read_text())
    selected=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))]
    space={'datetime':datetime,'results':[],'APPS':['haystack.service'],'save':lambda:None,'print':lambda *a,**k:None}
    helper=ROOT/'service-unit-graph-controller.py'
    if helper.exists():
        spec=importlib.util.spec_from_file_location('controller',helper);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        space.update(run_case=module.run_case,run_matrix=module.run_matrix)
    exec(compile(ast.Module(body=selected,type_ignores=[]),'actual-unit-graph-driver-functions','exec'),space)
    space['save']=lambda:None  # persistence is outside this controlled callback schedule
    return space

class HarnessRegression(unittest.TestCase):
    def test_ready_event_has_installed_signal_handler_at_exact_controlled_boundary(self):
        with tempfile.TemporaryDirectory() as work:
            root=pathlib.Path(work);secret=root/'secret';secret.write_text('synthetic-only')
            psql=root/'psql';psql.write_text('#!'+sys.executable+'\nprint("t")\n');psql.chmod(0o700)
            config=root/'config.json';config.write_text(json.dumps({'database':{'jdbcUrl':'jdbc:postgresql://127.0.0.1:15434/haystack','user':'haystack','passwordFile':str(secret)}}))
            tracer='''import os,runpy,signal,sys
source,config=sys.argv[1:];signal.signal(signal.SIGUSR1,signal.SIG_DFL)
def trace(frame,event,arg):
 if frame.f_code.co_filename==source and frame.f_code.co_name=='event' and event=='return' and frame.f_locals.get('name')=='unit_graph_adapter_start':
  print('CONTROLLED_READY_BOUNDARY',flush=True);os.read(0,1)
 return trace
sys.settrace(trace);sys.argv=[source,'haystack','base','serve',config];runpy.run_path(source,run_name='__main__')
'''
            child=subprocess.Popen([sys.executable,'-c',tracer,str(ROOT/'service-unit-graph-adapter.py'),str(config)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={**os.environ,'UNIT_GRAPH_PSQL':str(psql),'CREDENTIALS_DIRECTORY':work,'INVOCATION_ID':'a'*32})
            try:
                deadline=time.monotonic()+5;boundary=False;output=b''
                while time.monotonic()<deadline:
                    if not select.select([child.stdout],[],[],max(0,deadline-time.monotonic()))[0]:break
                    output+=os.read(child.stdout.fileno(),4096)
                    if b'CONTROLLED_READY_BOUNDARY\n' in output:boundary=True;break
                self.assertTrue(boundary,'did not reach actual readiness boundary')
                child.send_signal(signal.SIGUSR1);time.sleep(0.1)
                self.assertIsNone(child.poll(),'ready child died from default SIGUSR1 action before handler installation')
                child.stdin.write(b'x');child.stdin.flush()
                self.assertTrue(select.select([child.stdout],[],[],5)[0])
                self.assertEqual(json.loads(child.stdout.readline())['event'],'unit_graph_adapter_sql_probe_ok')
            finally:
                if child.poll() is None:child.terminate()
                try:child.wait(timeout=3)
                except subprocess.TimeoutExpired:child.kill();child.wait()
                child.stdin.close();child.stdout.close();child.stderr.close()

    def assert_probe_rejected(self,after):
        unit='haystack.service';before={'ActiveState':'active','InvocationID':'a','probeSuccessCount':0,'probeSuccessByInvocation':{'a':0}}
        space=functions();space['snapshot']=lambda:{unit:before};space['server']=types.SimpleNamespace(succeed=lambda _:None)
        def wait(predicate,_description,**_kwargs):
            if predicate({unit:after}):return {unit:after}
            raise TimeoutError('no current active invocation success')
        space['wait']=wait
        with self.assertRaises((TimeoutError,AssertionError)):space['probes']([unit])
    def test_inactive_child_old_success_is_not_reconnection(self):
        self.assert_probe_rejected({'ActiveState':'inactive','InvocationID':'a','probeSuccessCount':1,'probeSuccessByInvocation':{'a':1}})
    def test_replaced_child_old_success_is_not_reconnection(self):
        self.assert_probe_rejected({'ActiveState':'active','InvocationID':'b','probeSuccessCount':1,'probeSuccessByInvocation':{'a':1,'b':0}})
    def test_aggregate_success_from_another_invocation_is_not_reconnection(self):
        self.assert_probe_rejected({'ActiveState':'active','InvocationID':'a','probeSuccessCount':1,'probeSuccessByInvocation':{'a':0,'old':1}})

    def test_active_same_invocation_fresh_success_is_accepted(self):
        unit='haystack.service';before={'ActiveState':'active','InvocationID':'a','probeSuccessCount':0,'probeSuccessByInvocation':{'a':0}}
        after={**before,'probeSuccessCount':1,'probeSuccessByInvocation':{'a':1}}
        space=functions();space.update(snapshot=lambda:{unit:before},server=types.SimpleNamespace(succeed=lambda _:None),wait=lambda predicate,_: ({unit:after} if predicate({unit:after}) else self.fail('valid fresh evidence rejected')))
        self.assertEqual(space['probes']([unit]),{unit:after})

    def test_fault_assertion_is_not_misclassified_as_invalid_fixture(self):
        space=functions();space.update(snapshot=lambda:{},ready=lambda:{},restore=lambda:None)
        def fail(_item):raise AssertionError('controlled policy mismatch')
        item=space['case']('controlled',fail)
        self.assertEqual(item['status'],'fail');self.assertEqual(item['failedPhase'],'fault')
        self.assertTrue(item['faultEntered'] and item['canContinue'])

    def test_precondition_failure_never_enters_fault(self):
        space=functions();entered=[]
        def bad():raise RuntimeError('precondition missing')
        space.update(snapshot=lambda:{},ready=bad,restore=lambda:None)
        item=space['case']('controlled',lambda _:entered.append(True))
        self.assertFalse(entered);self.assertFalse(item['faultEntered']);self.assertEqual(item['status'],'invalid-fixture')

    def test_restore_failure_attributes_remaining_not_executed_cases(self):
        space=functions();space.update(snapshot=lambda:{},ready=lambda:{})
        def bad():raise RuntimeError('restore failed')
        space['restore']=bad
        records=space['run_all']([('first',lambda _:None),('second',lambda _:self.fail('must not run'))],lambda:None,lambda plan:space['case'](*plan))
        self.assertEqual(records[0]['status'],'invalid-fixture');self.assertEqual(records[0]['failedPhase'],'restore')
        self.assertEqual(records[1]['status'],'not-executed');self.assertEqual(records[1]['blockedByPhase'],'restore')

    def phase_failure(self,phase):
        space=functions();calls=0
        def snapshot():
            nonlocal calls
            calls+=1
            if (phase=='precondition' and calls==1) or (phase=='post-observation' and calls==2):raise RuntimeError('controlled snapshot unavailable')
            return {}
        def restore():
            if phase=='restore':raise RuntimeError('controlled restore failure')
        space.update(snapshot=snapshot,ready=snapshot,probes=lambda:None,restore=restore)
        space['case']('controlled',lambda _item:None)
        self.assertEqual(len(space['results']),1)
        item=space['results'][0]
        self.assertEqual(item['status'],'invalid-fixture')
        self.assertEqual(item['failedPhase'],phase)
    def test_precondition_failure_has_attributed_terminal_record(self):self.phase_failure('precondition')
    def test_post_observation_failure_has_attributed_terminal_record(self):self.phase_failure('post-observation')
    def test_restore_failure_has_attributed_terminal_record(self):self.phase_failure('restore')
    def test_bootstrap_failure_preserves_all_declared_not_executed_cases(self):
        space=functions();seen=[]
        def bad():raise RuntimeError('controlled boot failure')
        plans=[('first',lambda _:None),('second',lambda _:None)]
        records=space['run_all'](plans,bad,lambda _:seen.append(1))
        self.assertFalse(seen)
        self.assertEqual([r['name'] for r in records],['first','second'])
        self.assertTrue(all(r['status']=='not-executed' and r['blockedByPhase']=='bootstrap' for r in records))

if __name__=='__main__':unittest.main()
