#!/usr/bin/env python3
"""Positive target-process test inventory; missing prerequisites/skips FAIL full runs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest

root=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(root/'manure'),str(root/'manure/tests')]
p=argparse.ArgumentParser();p.add_argument('--scope',choices=['core','full','focused'],required=True);p.add_argument('--report',required=True)
a=p.parse_args();report=Path(a.report);report.mkdir(parents=True,exist_ok=True)
modules=['test_current_protocol','test_current_client','test_current_target_harness','test_dashboard_markup','test_client_realserver','test_cli_process']
if (root/'manure/tests/test_target_migration.py').exists():modules.append('test_target_migration')
if (root/'manure/tests/test_target_mcp.py').exists():modules.append('test_target_mcp')
if a.scope=='full':modules += [path.stem for path in sorted((root/'manure/tests').glob('test_browser_*.py'))]
if a.scope=='focused':
    modules=json.loads(os.environ['MANURE_TARGET_DIAGNOSTIC_TESTS_JSON'])
    import re
    assert isinstance(modules,list) and modules and all(isinstance(n,str) and re.fullmatch(r'test_[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+){0,2}',n) for n in modules)
loader=unittest.TestLoader();suite=loader.loadTestsFromNames(modules)
def cases(node):
    if isinstance(node,unittest.TestSuite):
        for child in node:yield from cases(child)
    else:yield node.id()
expected=list(cases(suite));assert expected and len(set(expected))==len(expected)
(report/'inventory.json').write_text(json.dumps({'scope':a.scope,'modules':modules,'tests':expected},indent=2)+'\n')
class Result(unittest.TextTestResult):
    def __init__(self,*args,**kwargs):super().__init__(*args,**kwargs);self.executed=[]
    def startTest(self,test):self.executed.append(test.id());super().startTest(test)
    def _record(self,test,status,error=None):
        import traceback
        entry={'test':test.id(),'status':status}
        if error is not None:entry['detail']=''.join(traceback.format_exception(*error))
        with (report/'outcomes.jsonl').open('a') as output:
            output.write(json.dumps(entry)+'\n');output.flush();os.fsync(output.fileno())
    def addSuccess(self,test):self._record(test,'passed');super().addSuccess(test)
    def addFailure(self,test,error):self._record(test,'failed',error);super().addFailure(test,error)
    def addError(self,test,error):self._record(test,'error',error);super().addError(test,error)
    def addSkip(self,test,reason):self._record(test,'skipped');super().addSkip(test,reason)
result=unittest.TextTestRunner(verbosity=2,resultclass=Result).run(suite)
summary={'scope':a.scope,'suites':len(modules),'expected':len(expected),'tests':result.testsRun,
         'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),
         'expectedFailures':len(result.expectedFailures),'unexpectedSuccesses':len(result.unexpectedSuccesses),
         'inventoryMatches':sorted(expected)==sorted(result.executed)}
(report/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,sort_keys=True))
raise SystemExit(0 if result.wasSuccessful() and not result.skipped and not result.expectedFailures and summary['inventoryMatches'] else 1)
