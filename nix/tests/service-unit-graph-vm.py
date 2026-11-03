# Behavioral-Active / Blackbox-GoodCommunication: real systemd public lifecycle.
# Specified matrix. Synthetic app CLIs are explicit; PG, module units/configs,
# role authentication and switch-to-configuration are real inside one owned VM.
import datetime,importlib.util,json,os,pathlib,shutil,time
controller_spec=importlib.util.spec_from_file_location("unit_graph_controller",CONTROLLER_SOURCE_PATH)
controller=importlib.util.module_from_spec(controller_spec);controller_spec.loader.exec_module(controller)
run_case,run_matrix=controller.run_case,controller.run_matrix

APPS=['chronicle.service','haystack.service','manure.service']
PROVIDER='postgresql.service'
DATABASES=['ponygirls-database-'+s+'.service' for s in ['chronicle','haystack','manure']]
MIGRATIONS=['chronicle-migrate.service','haystack-setup.service','manure-migrate.service']
UNITS=[PROVIDER]+DATABASES+MIGRATIONS+APPS
results=[]
out=pathlib.Path(os.environ['out']);out.mkdir(exist_ok=True)
shutil.copyfile(SOURCE_MANIFEST,out/'source-inputs.sha256')

def snapshot():
    return json.loads(server.succeed('/etc/unit-graph/snapshot '+' '.join(UNITS)))
def wait(predicate,description,seconds=60):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        state=snapshot()
        if predicate(state):return state
        time.sleep(0.25)
    raise AssertionError(description)
def ready(apps=APPS):
    required=[PROVIDER]+DATABASES+[m for a,m in zip(APPS,MIGRATIONS) if a in apps]+apps
    def valid(s):
        return all(s[u]['ActiveState']=='active' for u in required) and all(s[u]['InvocationID'] in s[u]['adapterStartedInvocations'] for u in required if u in APPS+MIGRATIONS)
    return wait(valid,'actual generated units/adapter readiness did not recover')
def stable(before,after,units):
    for unit in units:
        for field in ['MainPID','ExecMainStartTimestampMonotonic','InvocationID','startCount']:
            assert before[unit][field]==after[unit][field],(unit,field,before[unit][field],after[unit][field])
def probes(apps=APPS):
    before=snapshot()
    intended={u:before[u]['InvocationID'] for u in apps}
    assert all(before[u]['ActiveState']=='active' and intended[u] for u in apps)
    server.succeed('systemctl kill --kill-whom=main --signal=USR1 '+' '.join(apps))
    return wait(lambda s:all(s[u]['ActiveState']=='active' and s[u]['InvocationID']==intended[u] and s[u]['probeSuccessByInvocation'].get(intended[u],0)>before[u]['probeSuccessByInvocation'].get(intended[u],0) for u in apps),'no fresh SQL success from the active intended invocation')
def save():
    receipt={'scope':'actual NixOS module/systemd/real PG lifecycle with explicitly synthetic app CLI adapters; NOT native application/protocol acceptance','sourceRevision':SOURCE_REVISION,'manualStopStartPolicy':'provider stop deliberately stops dependents; provider start alone must not resurrect apps; explicitly starting selected consumers restores their own readiness/migrations','cases':results,'failures':sum(c['status']!='pass' for c in results),'mandatoryCases':len(results),'faultsExecuted':sum(bool(c.get('faultEntered')) for c in results),'notExecuted':[c['name'] for c in results if not c.get('faultEntered')],'invalidFixtureCases':[c['name'] for c in results if c['status']=='invalid-fixture']}
    (out/'lifecycle-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
def restore():
    current=server.succeed('readlink -f /run/current-system').strip()
    if current!=base:server.succeed(base+'/bin/switch-to-configuration test')
    server.succeed('systemctl start '+PROVIDER)
    server.succeed('systemctl start '+' '.join(APPS))
    return ready()
def case(name,body):
    def update(item):
        for index,existing in enumerate(results):
            if existing['name']==name:results[index]=item;break
        else:results.append(item)
        save()
    item=run_case(name,body,ready,snapshot,restore,update)
    print('UNIT_GRAPH_MILESTONE '+name+' '+item['status'],flush=True)
    return item

def run_all(plans,bootstrap,execute):
    return run_matrix(plans,bootstrap,execute,records=results,persist=save)

def bootstrap():
    global base
    start_all()
    server.wait_for_unit('multi-user.target')
    base=server.succeed('readlink -f /run/current-system').strip()
    ready();probes()

PLANS=[('boot-three-consumers-one-provider-independent-ready-and-migrations',lambda item:ready())]

def own_restart(item):
    server.succeed('systemctl restart haystack.service');after=ready();probes()
    stable(item['before'],after,[PROVIDER]+DATABASES+MIGRATIONS+['chronicle.service','manure.service'])
    assert after['haystack.service']['MainPID']!=item['before']['haystack.service']['MainPID']
    assert after['haystack.service']['startCount']>item['before']['haystack.service']['startCount']
PLANS.append(('own-app-restart-leaves-provider-other-apps-and-migrations-stable',own_restart))

def provider_restart(item):
    server.succeed('systemctl restart '+PROVIDER);after=ready();probes()
    assert after[PROVIDER]['MainPID']!=item['before'][PROVIDER]['MainPID']
PLANS.append(('explicit-provider-restart-recovers-previously-active-complete-chain',provider_restart))

def crash(item):
    server.succeed('systemctl kill --kill-whom=main --signal=KILL '+PROVIDER)
    after=wait(lambda s:s[PROVIDER]['ActiveState']=='active' and s[PROVIDER]['MainPID'] not in [0,item['before'][PROVIDER]['MainPID']],'provider did not actually auto-restart')
    ready();probes()
    assert after[PROVIDER]['NRestarts']>item['before'][PROVIDER]['NRestarts']
PLANS.append(('provider-crash-autorestart-bounded-unit-and-real-role-reconnection',crash))

def inactive_consumer(item):
    server.succeed('systemctl stop manure.service')
    server.succeed('systemctl restart '+PROVIDER)
    after=ready(['chronicle.service','haystack.service']);probes(['chronicle.service','haystack.service'])
    assert after['manure.service']['ActiveState']=='inactive'
PLANS.append(('intentionally-stopped-consumer-is-not-resurrected-by-provider-restart',inactive_consumer))

def manual(item):
    server.succeed('systemctl stop '+PROVIDER)
    wait(lambda s:all(s[u]['ActiveState']=='inactive' for u in UNITS),'manual provider stop did not stop complete required chain')
    server.succeed('systemctl start '+PROVIDER)
    wait(lambda s:s[PROVIDER]['ActiveState']=='active','manual provider start failed')
    assert all(snapshot()[u]['ActiveState']=='inactive' for u in APPS)
    server.succeed('systemctl start chronicle.service haystack.service')
    ready(['chronicle.service','haystack.service']);probes(['chronicle.service','haystack.service'])
    assert snapshot()['manure.service']['ActiveState']=='inactive'
PLANS.append(('manual-stop-start-policy-explicit-selected-app-recovery',manual))

def migration(item):
    server.succeed('systemctl restart haystack-setup.service');after=ready();probes()
    stable(item['before'],after,[PROVIDER]+DATABASES+['chronicle.service','manure.service','chronicle-migrate.service','manure-migrate.service'])
PLANS.append(('own-migration-restart-leaves-provider-and-unrelated-consumers-stable',migration))

def package(item):
    server.succeed(base+'/specialisation/app-package/bin/switch-to-configuration test')
    after=ready();probes()
    stable(item['before'],after,[PROVIDER]+DATABASES+['chronicle.service','manure.service','chronicle-migrate.service','manure-migrate.service'])
    assert after['haystack.service']['startCount']>item['before']['haystack.service']['startCount']
    assert after['haystack-setup.service']['startCount']>item['before']['haystack-setup.service']['startCount']
    assert after['haystack.service']['adapterTags'][-1]=='alternate'
PLANS.append(('actual-package-switch-restarts-only-own-app-and-migration',package))

def disabled(item):
    server.succeed(base+'/specialisation/disabled-consumer/bin/switch-to-configuration test')
    after=ready(['chronicle.service','haystack.service'])
    stable(item['before'],after,[PROVIDER]+DATABASES+['chronicle.service','haystack.service','chronicle-migrate.service','haystack-setup.service'])
    assert after['manure.service']['ActiveState']=='inactive'
    assert after['manure-migrate.service']['ActiveState']=='inactive'
    server.succeed('systemctl restart '+PROVIDER)
    after=ready(['chronicle.service','haystack.service']);probes(['chronicle.service','haystack.service'])
    assert after['manure.service']['ActiveState']=='inactive' and after['manure-migrate.service']['ActiveState']=='inactive'
PLANS.append(('actual-disabled-module-preserves-provider-db-and-others-stays-disabled-after-restart',disabled))

run_all(PLANS,bootstrap,lambda plan:case(*plan))
save()
assert len(results)==9 and all(c['status']=='pass' for c in results),'actual module lifecycle matrix failed; inspect lifecycle-receipt.json (no dependency fix has been assumed)'
