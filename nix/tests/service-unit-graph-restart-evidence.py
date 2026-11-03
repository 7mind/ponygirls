#!/usr/bin/env python3
"""Test-only journal cursor evidence; never reads/prints MESSAGE or SQL."""
import argparse,json,pathlib,re,subprocess
RESTART_ID='5eb03494b6584870a536b337290809b3'
class Journal:
    def __init__(self,scope):
        assert scope in ('system','user');self.scope=scope
    def query(self,arguments):
        result=subprocess.run(['journalctl',*(['--user'] if self.scope=='user' else []),'-b','--no-pager','-o','json','--output-fields=__CURSOR,_BOOT_ID,MESSAGE_ID,UNIT,USER_UNIT',*arguments],check=True,stdout=subprocess.PIPE,text=True,timeout=10)
        return [json.loads(line) for line in result.stdout.splitlines()]
    def capture(self):
        entries=self.query(['-n','1']);assert len(entries)==1
        entry=entries[0];return {'cursor':entry['__CURSOR'],'bootId':entry['_BOOT_ID']}
    def after(self,cursor,boot):return self.query(['--after-cursor='+cursor,'_BOOT_ID='+boot])

def fresh_restarts(journal,reference,unit):
    assert reference['cursor'] and re.fullmatch('[0-9a-f]{32}',reference['bootId'])
    field='USER_UNIT' if journal.scope=='user' else 'UNIT'
    entries=journal.after(reference['cursor'],reference['bootId'])
    return [{'cursor':entry['__CURSOR'],'bootId':entry['_BOOT_ID'],'unit':entry[field],'messageId':entry['MESSAGE_ID']} for entry in entries if entry.get('__CURSOR')!=reference['cursor'] and entry.get('_BOOT_ID')==reference['bootId'] and entry.get(field)==unit and entry.get('MESSAGE_ID')==RESTART_ID]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['capture','after']);parser.add_argument('--scope',choices=['system','user'],required=True);parser.add_argument('--cursor');parser.add_argument('--boot');parser.add_argument('--unit');args=parser.parse_args()
    journal=Journal(args.scope)
    if args.mode=='capture':value=journal.capture()
    else:
        assert args.cursor and args.boot and args.unit
        events=fresh_restarts(journal,{'cursor':args.cursor,'bootId':args.boot},args.unit);value={'events':events,'count':len(events)}
    print(json.dumps(value,sort_keys=True))
if __name__=='__main__':main()
