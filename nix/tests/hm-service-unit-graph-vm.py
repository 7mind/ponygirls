# Behavioral-Active/Blackbox-GoodCommunication: actual HM USER systemd graph.
# Deliberately no native HTTP/model acceptance. All services share alice's UID.
import importlib.util,json,os,pathlib,shlex,shutil,time
spec=importlib.util.spec_from_file_location('controller',CONTROLLER_SOURCE_PATH);controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)
PROVIDER='ponygirls-postgres.service'
APPS=['chronicle.service','ivm-haystack.service','ivm-manure.service']
MIGRATIONS=['chronicle-migrate.service','ivm-haystack-migrate.service','ivm-manure-migrate.service']
DATABASES=['ponygirls-database-'+name+'.service' for name in ['chronicle','haystack','manure']]
UNITS=[PROVIDER]+DATABASES+MIGRATIONS+APPS
results=[];out=pathlib.Path(os.environ['out']);out.mkdir(exist_ok=True);shutil.copyfile(SOURCE_MANIFEST,out/'source-inputs.sha256')
PREFIX='runuser -u alice -- env XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus '
def user(command):return home.succeed(PREFIX+command)
def ctl(command):return user('systemctl --user '+command)
def snapshot():return json.loads(user('/etc/unit-graph-user/snapshot '+' '.join(UNITS)))
def wait(predicate,description,seconds=60):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        state=snapshot()
        if predicate(state):return state
        time.sleep(.25)
    raise AssertionError(description)
def ready_chains(apps,databases):
    required=[PROVIDER]+databases+[m for a,m in zip(APPS,MIGRATIONS) if a in apps]+apps
    return wait(lambda s:all(s[u]['ActiveState']=='active' for u in required) and all(s[u]['InvocationID'] in s[u]['adapterStartedInvocations'] for u in required if u in APPS+MIGRATIONS),'actual HM units did not become ready')
def ready(apps=APPS):return ready_chains(apps,DATABASES)
def probes(apps=APPS):
    before=snapshot();intended={u:before[u]['InvocationID'] for u in apps}
    assert all(before[u]['ActiveState']=='active' and intended[u] for u in apps)
    ctl('kill --kill-whom=main --signal=USR1 '+' '.join(apps))
    return wait(lambda s:all(s[u]['ActiveState']=='active' and s[u]['InvocationID']==intended[u] and s[u]['probeSuccessByInvocation'].get(intended[u],0)>before[u]['probeSuccessByInvocation'].get(intended[u],0) for u in apps),'no fresh active intended HM invocation SQL success')
def stable(before,after,units):
    for unit in units:
        for field in ['MainPID','ExecMainStartTimestampMonotonic','InvocationID','startCount']:
            assert before[unit][field]==after[unit][field],(unit,field)
def save():
    receipt={'scope':'actual HM modules/systemd USER manager/real PG with explicit synthetic CLI adapters; NOT native app/HTTP/model acceptance','trustBoundary':'all HM services share alice UID1000; role ACLs do not isolate credentials from same-UID processes','sourceRevision':SOURCE_REVISION,'manualStopStartPolicy':'intentional stop leaves consumers down; provider start alone does not resurrect; selected app start restores own chain','cases':results,'mandatoryCases':len(results),'faultsExecuted':sum(bool(c.get('faultEntered')) for c in results),'notExecuted':[c['name'] for c in results if not c.get('faultEntered')],'invalidFixtureCases':[c['name'] for c in results if c['status']=='invalid-fixture']}
    (out/'lifecycle-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
def restore():
    if home.succeed('readlink -f /run/current-system').strip()!=base:
        home.succeed(base+'/bin/switch-to-configuration test');home.wait_for_unit('home-manager-alice.service',timeout=120)
    ctl('start '+PROVIDER);ctl('start '+' '.join(APPS));return ready()
def case(name,body):
    def update(item):
        for index,prior in enumerate(results):
            if prior['name']==name:results[index]=item;break
        save()
    item=controller.run_case(name,body,ready,snapshot,restore,update)
    print('HM_UNIT_GRAPH_MILESTONE '+name+' '+item['status'],flush=True);return item

def bootstrap():
    global base
    print('HM_UNIT_GRAPH_BOOTSTRAP launch-owned-user-manager-VM',flush=True)
    start_all();home.wait_for_unit('user@1000.service',timeout=120);home.wait_for_unit('home-manager-alice.service',timeout=120)
    base=home.succeed('readlink -f /run/current-system').strip()
    home.succeed('! systemctl is-active --quiet postgresql.service')
    print('HM_UNIT_GRAPH_BOOTSTRAP_STATE '+json.dumps(snapshot(),sort_keys=True),flush=True)
    ready();probes()

def boot(item):ready();probes()
def own_restart(item):
    ctl('restart ivm-haystack.service');after=ready();probes()
    stable(item['before'],after,[PROVIDER]+DATABASES+MIGRATIONS+['chronicle.service','ivm-manure.service'])
    assert after['ivm-haystack.service']['MainPID']!=item['before']['ivm-haystack.service']['MainPID']
def provider_restart(item):
    ctl('restart '+PROVIDER);after=ready();probes()
    assert after[PROVIDER]['MainPID']!=item['before'][PROVIDER]['MainPID']
def crash(item):
    reference=json.loads(user('/etc/unit-graph-user/restart-evidence capture --scope user'))
    ctl('kill --kill-whom=main --signal=KILL '+PROVIDER)
    after=wait(lambda s:s[PROVIDER]['ActiveState']=='active' and s[PROVIDER]['MainPID'] not in [0,item['before'][PROVIDER]['MainPID']],'HM provider did not auto-restart')
    ready();probes();after=snapshot()
    evidence=json.loads(user('/etc/unit-graph-user/restart-evidence after --scope user --unit '+PROVIDER+' --cursor '+shlex.quote(reference['cursor'])+' --boot '+shlex.quote(reference['bootId'])))
    item['automaticRestartEvidence']={'reference':reference,**evidence};assert evidence['count']>0
    assert after[PROVIDER]['InvocationID']!=item['before'][PROVIDER]['InvocationID']
def stopped(item):
    ctl('stop ivm-manure.service');ctl('restart '+PROVIDER)
    after=ready(['chronicle.service','ivm-haystack.service']);probes(['chronicle.service','ivm-haystack.service'])
    assert after['ivm-manure.service']['ActiveState']=='inactive'
def manual(item):
    ctl('stop '+PROVIDER);wait(lambda s:all(s[u]['ActiveState']=='inactive' for u in UNITS),'HM manual stop left a dependent active')
    ctl('start '+PROVIDER);wait(lambda s:s[PROVIDER]['ActiveState']=='active','HM manual provider start failed')
    assert all(snapshot()[u]['ActiveState']=='inactive' for u in APPS)
    ctl('start chronicle.service ivm-haystack.service');ready_chains(APPS[:2],DATABASES[:2]);probes(APPS[:2])
    assert snapshot()['ivm-manure.service']['ActiveState']=='inactive'
def disabled(item):
    home.succeed(base+'/specialisation/disabled-consumer/bin/switch-to-configuration test');home.wait_for_unit('home-manager-alice.service',timeout=120)
    after=ready(['chronicle.service','ivm-haystack.service'])
    stable(item['before'],after,[PROVIDER]+DATABASES+['chronicle.service','ivm-haystack.service','chronicle-migrate.service','ivm-haystack-migrate.service'])
    assert after['ivm-manure.service']['ActiveState']=='inactive'
    ctl('restart '+PROVIDER);after=ready(['chronicle.service','ivm-haystack.service']);probes(['chronicle.service','ivm-haystack.service'])
    assert after['ivm-manure.service']['ActiveState']=='inactive' and after['ivm-manure-migrate.service']['ActiveState']=='inactive'

PLANS=[('HM-boot-three-consumers-one-user-provider',boot),('HM-own-app-restart-isolates-provider-others',own_restart),('HM-explicit-provider-restart-recovers-active-chain',provider_restart),('HM-provider-crash-autorestart-fresh-role-reconnect',crash),('HM-stopped-consumer-stays-stopped',stopped),('HM-intentional-manual-stop-start-selected-recovery',manual),('HM-actual-disabled-module-stays-disabled',disabled)]
controller.run_matrix(PLANS,bootstrap,lambda plan:case(*plan),records=results,persist=save)
save();print('UNIT_GRAPH_TERMINAL '+(out/'lifecycle-receipt.json').read_text().replace('\n',' '),flush=True)
assert len(results)==7 and all(c['status']=='pass' for c in results),'actual HM user-manager lifecycle matrix failed; no policy fix inferred'
