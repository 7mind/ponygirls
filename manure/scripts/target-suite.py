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
p=argparse.ArgumentParser();p.add_argument('--scope',choices=['core','full'],required=True);p.add_argument('--report',required=True)
a=p.parse_args();report=Path(a.report);report.mkdir(parents=True,exist_ok=True)
modules=['test_current_protocol','test_current_client','test_current_target_harness','test_dashboard_markup','test_client_realserver','test_cli_process']
if (root/'manure/tests/test_target_migration.py').exists():modules.append('test_target_migration')
if (root/'manure/tests/test_target_mcp.py').exists():modules.append('test_target_mcp')
if a.scope=='full':modules += [path.stem for path in sorted((root/'manure/tests').glob('test_browser_*.py'))]
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
result=unittest.TextTestRunner(verbosity=2,resultclass=Result).run(suite)
summary={'scope':a.scope,'suites':len(modules),'expected':len(expected),'tests':result.testsRun,
         'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),
         'expectedFailures':len(result.expectedFailures),'unexpectedSuccesses':len(result.unexpectedSuccesses),
         'inventoryMatches':sorted(expected)==sorted(result.executed)}
(report/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,sort_keys=True))
raise SystemExit(0 if result.wasSuccessful() and not result.skipped and not result.expectedFailures and summary['inventoryMatches'] else 1)
