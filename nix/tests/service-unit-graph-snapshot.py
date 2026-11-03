#!/usr/bin/env python3
"""Only allowlisted systemd state/start counts and synthetic-fixture events."""
import json,os,subprocess,sys
units=sys.argv[1:]
manager=os.environ.get("UNIT_GRAPH_MANAGER","system");assert manager in ("system","user")
scope=["--user"] if manager=="user" else []
properties='Id,LoadState,ActiveState,SubState,MainPID,ExecMainStartTimestampMonotonic,InvocationID,NRestarts,Requires,After,PartOf,BindsTo,Wants'
result=subprocess.run(['systemctl',*scope,'show','--no-pager','--property='+properties,*units],check=True,stdout=subprocess.PIPE,text=True,timeout=10)
state={}
for block in result.stdout.strip().split('\n\n'):
    values=dict(line.split('=',1) for line in block.splitlines())
    unit=values['Id'];assert unit in units
    for key in ['MainPID','ExecMainStartTimestampMonotonic','NRestarts']:
        values[key]=int(values.get(key,'0'))
    assert values['ActiveState'] and values['SubState'] and values['LoadState']
    if values['ActiveState']=='active':assert values['InvocationID']
    values.update(restartScheduledCount=0,startCount=0,adapterStartedInvocations=[],probeSuccessCount=0,probeSuccessByInvocation={},adapterTags=[])
    state[unit]=values
assert set(state)==set(units)
journal=subprocess.run(['journalctl',*scope,'-b','--no-pager','-o','json','--output-fields=MESSAGE_ID,UNIT,USER_UNIT,_SYSTEMD_UNIT,_SYSTEMD_USER_UNIT,MESSAGE'],check=True,stdout=subprocess.PIPE,text=True,timeout=10)
for line in journal.stdout.splitlines():
    entry=json.loads(line)
    unit=entry.get('USER_UNIT' if manager=='user' else 'UNIT')
    if unit in state and entry.get('MESSAGE_ID')=='39f53479d3a045ac8e11786248231fbf':state[unit]['startCount']+=1
    if unit in state and entry.get('MESSAGE_ID')=='5eb03494b6584870a536b337290809b3':state[unit]['restartScheduledCount']+=1
    unit=entry.get('_SYSTEMD_USER_UNIT' if manager=='user' else '_SYSTEMD_UNIT')
    if unit not in state:continue
    try:message=json.loads(entry.get('MESSAGE',''))
    except (ValueError,TypeError):continue
    if not isinstance(message,dict):continue
    if message.get('event')=='unit_graph_adapter_start':
        state[unit]['adapterStartedInvocations'].append(message['invocation']);state[unit]['adapterTags'].append(message['tag'])
    if message.get('event')=='unit_graph_adapter_sql_probe_ok':
        state[unit]['probeSuccessCount']+=1
        invocation=message['invocation'];counts=state[unit]['probeSuccessByInvocation'];counts[invocation]=counts.get(invocation,0)+1
print(json.dumps(state,sort_keys=True))
