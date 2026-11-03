"""Actual archived legacy SQLite implementation, synthetic acknowledged inputs only."""
import hashlib,json,math,sys,tempfile
from pathlib import Path
from manure.storage import ArtifactStore
from manure import domain as D
names=['Straße','STRASSE','ΟΣ','οσ','ος','cat-one','CAT-two','Cat-three','literal%_','edge\0needle','\ue000','𐀀']
t=1700000000.125

def export(a):
    return {**{k:a.get(k) for k in ('id','name','kind','visibility','created_by_user','created_by_token','created_at','created_at_s','expires_at','expires_at_s','state','total_bytes','file_count','reserved_bytes','last_activity_at')},'manifest_json':json.dumps(a['manifest'],ensure_ascii=False,separators=(',',':'))}
def walk(s,**options):
    cursor='';out=[];pages=0
    while True:
        values,cursor=s.list_artifacts(cursor=cursor,**options);out.extend(a['id'] for a in values);pages+=1
        assert pages<20 and len(out)==len(set(out))
        if cursor is None:return out
with tempfile.TemporaryDirectory(prefix='manure160-legacy-review-') as temp:
    store=ArtifactStore(temp,now=lambda:t,chunk_bytes=1048576)
    try:
        ack=[]
        for i,name in enumerate(names):
            directory=i%2==0;data=b'good'
            entries=[{'path':'empty','kind':'dir'}] if directory else [{'path':'file.txt','kind':'file','size':4,'sha256':hashlib.sha256(data).hexdigest()}]
            a=store.init_artifact('owner\0馬','primary',name,'dir' if directory else 'file','public',entries,None)
            if not directory:store.put_chunk('owner\0馬',a['id'],'file.txt',0,data,hashlib.sha256(data).hexdigest())
            store.publish('owner\0馬',a['id']);ack.append(export(store.get_artifact(a['id'])))
        matches=[]
        for q in ('strasse','σ','%_','\0needle','𐀀'):
            values,_=store.list_artifacts(50,'',True,q=q,sort_by='name',direction='asc')
            matches.append({'query':q,'names':[a['name'] for a in values]})
        first,cursor=store.list_artifacts(1,'',True,q='cat',sort_by='name',direction='asc')
        second,_=store.list_artifacts(1,cursor,True,q='CAT',sort_by='name',direction='asc')
        long_result,_=store.list_artifacts(50,'',True,q='x'*1025,sort_by='name',direction='asc')
        # Controlled metadata fixture for ordering, distinct from the acknowledged matching baseline.
        for i,a in enumerate(ack):
            created=[t,math.nextafter(t,math.inf),t+1,t][i%4]
            expiry=[None,t+60,t-60,t][i%4]
            total=[9007199254740992,9007199254740993,2**63-1,0][i%4]
            count=[0,1,1,2][i%4]
            owner=['owner\0馬','\ue000','𐀀'][i%3]
            vis=['public','internal','external'][i%3];state=['uploading','publishing','ready'][i%3]
            store._db.execute('UPDATE artifacts SET created_at=?,created_at_s=?,expires_at=?,expires_at_s=?,total_bytes=?,file_count=?,created_by_user=?,visibility=?,state=? WHERE id=?',(D.format_time(created),created,None if expiry is None else D.format_time(expiry),expiry,total,count,owner,vis,state,a['id']))
        store._db.commit()
        rows=[export(store.get_artifact(a['id'])) for a in ack]
        sorts=[]
        for sort in D.CatalogueQuery.SORT_FIELDS:
            for direction in ('asc','desc'):
                sorts.append({'sort':sort,'direction':direction,'ids':walk(store,limit=2,include_expired=True,q='',sort_by=sort,direction=direction)})
        filters=[]
        for vis,state in ((None,None),('public',None),(None,'ready'),('external','ready')):
            filters.append({'visibility':vis,'state':state,'ids':walk(store,limit=1,include_expired=False,visibility=vis,state=state,q='',sort_by='expires_at',direction='desc')})
        print(json.dumps({'clock':t,'ackRows':ack,'matching':matches,'equivalentCursor':{'firstNames':[a['name'] for a in first],'secondNames':[a['name'] for a in second],'accepted':True},'longQuery':{'length':1025,'accepted':True,'names':[a['name'] for a in long_result]},'sortRows':rows,'sorts':sorts,'filters':filters},ensure_ascii=True,indent=2))
    finally:store.close()
