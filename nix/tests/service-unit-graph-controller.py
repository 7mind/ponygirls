"""Test-only phase controller: never attribute an invalid fixture to policy."""
import datetime

def run_case(name,body,precondition,observe,restore,on_update=lambda _item:None):
    item={'name':name,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'running','faultEntered':False,'phases':{p:'not-entered' for p in ['precondition','fault','post-observation','restore']},'phaseErrors':[]}
    def phase(name,action):
        item['phases'][name]='running';on_update(item)
        try:
            value=action();item['phases'][name]='pass';on_update(item);return True,value
        except Exception as error:
            item['phases'][name]='fail';item['phaseErrors'].append({'phase':name,'error':str(error)[:1200]});on_update(item);return False,None
    valid,before=phase('precondition',precondition)
    if valid:
        item['before']=before;item['faultEntered']=True
        phase('fault',lambda:body(item))
    observed,after=phase('post-observation',observe)
    if observed:item['after']=after
    restored,restored_state=phase('restore',restore)
    if restored:item['restored']=restored_state
    invalid=[entry for entry in item['phaseErrors'] if entry['phase']!='fault']
    if invalid:item.update(status='invalid-fixture',failedPhase=invalid[-1]['phase'])
    elif item['phaseErrors']:item.update(status='fail',failedPhase='fault')
    else:item['status']='pass'
    item['canContinue']=restored;on_update(item)
    return item

def run_matrix(plans,bootstrap,execute,records=None,persist=lambda:None):
    records=[] if records is None else records
    records[:]=[{'name':name,'status':'not-executed','faultEntered':False,'blockedByPhase':'bootstrap'} for name,_body in plans]
    persist()
    try:bootstrap()
    except Exception as error:
        for item in records:item['blockedError']=str(error)[:1200]
        persist();return records
    for index,plan in enumerate(plans):
        try:item=execute(plan)
        except Exception as error:
            item={'name':plan[0],'status':'invalid-fixture','faultEntered':False,'failedPhase':'controller','phaseErrors':[{'phase':'controller','error':str(error)[:1200]}],'canContinue':False}
        records[index]=item;persist()
        if not item.get('canContinue',False):
            for pending in records[index+1:]:pending.update(blockedByPhase=item.get('failedPhase','controller'),blockedByCase=item['name'])
            persist();break
    return records
