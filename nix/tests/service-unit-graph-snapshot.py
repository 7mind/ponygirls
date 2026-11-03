#!/usr/bin/env python3
"""Only allowlisted systemd state/start counts and synthetic-fixture events."""
import json,subprocess,sys
units=sys.argv[1:]
properties='Id,LoadState,ActiveState,SubState,MainPID,ExecMainStartTimestampMonotonic,InvocationID,NRestarts'
result=subprocess.run(['systemctl','show','--no-pager','--property='+properties,*units],check=True,stdout=subprocess.PIPE,text=True,timeout=10)
state={}
for block in result.stdout.strip().split('\n\n'):
    values=dict(line.split('=',1) for line in block.splitlines())
    unit=values['Id'];assert unit in units
    for key in ['MainPID','ExecMainStartTimestampMonotonic','NRestarts']:
        values[key]=int(values.get(key,'0'))
    assert values['ActiveState'] and values['SubState'] and values['LoadState']
    if values['ActiveState']=='active':assert values['InvocationID']
    values.update(startCount=0,adapterStartedInvocations=[],probeSuccessCount=0,adapterTags=[])
    state[unit]=values
assert set(state)==set(units)
journal=subprocess.run(['journalctl','-b','--no-pager','-o','json','--output-fields=MESSAGE_ID,UNIT,_SYSTEMD_UNIT,MESSAGE'],check=True,stdout=subprocess.PIPE,text=True,timeout=10)
for line in journal.stdout.splitlines():
    entry=json.loads(line)
    unit=entry.get('UNIT')
    if unit in state and entry.get('MESSAGE_ID')=='39f53479d3a045ac8e11786248231fbf':state[unit]['startCount']+=1
    unit=entry.get('_SYSTEMD_UNIT')
    if unit not in state:continue
    try:message=json.loads(entry.get('MESSAGE',''))
    except (ValueError,TypeError):continue
    if not isinstance(message,dict):continue
    if message.get('event')=='unit_graph_adapter_start':
        state[unit]['adapterStartedInvocations'].append(message['invocation']);state[unit]['adapterTags'].append(message['tag'])
    if message.get('event')=='unit_graph_adapter_sql_probe_ok':state[unit]['probeSuccessCount']+=1
print(json.dumps(state,sort_keys=True))
