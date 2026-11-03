{ pkgs }:
pkgs.runCommand "actual-unit-graph-harness-controlled-regressions" {nativeBuildInputs=[pkgs.python3 pkgs.coreutils];} ''
  mkdir source
  cp ${./service-unit-graph-adapter.py} source/service-unit-graph-adapter.py
  cp ${./service-unit-graph-vm.py} source/service-unit-graph-vm.py
  cp ${./service-unit-graph-snapshot.py} source/service-unit-graph-snapshot.py
  cp ${./service-unit-graph-controller.py} source/service-unit-graph-controller.py
  cp ${./service-unit-graph-harness-test.py} source/service-unit-graph-harness-test.py
  export UNIT_GRAPH_TEST_SOURCE_DIR="$PWD/source"
  mkdir "$out"
  python3 - "$out" <<'PY'
  import hashlib,importlib.util,json,pathlib,sys,unittest
  root=pathlib.Path('source');spec=importlib.util.spec_from_file_location('harness_tests',root/'service-unit-graph-harness-test.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  expected={
    'test_ready_event_has_installed_signal_handler_at_exact_controlled_boundary',
    'test_inactive_child_old_success_is_not_reconnection',
    'test_replaced_child_old_success_is_not_reconnection',
    'test_aggregate_success_from_another_invocation_is_not_reconnection',
    'test_active_same_invocation_fresh_success_is_accepted',
    'test_fault_assertion_is_not_misclassified_as_invalid_fixture',
    'test_precondition_failure_never_enters_fault',
    'test_precondition_failure_has_attributed_terminal_record',
    'test_post_observation_failure_has_attributed_terminal_record',
    'test_restore_failure_has_attributed_terminal_record',
    'test_restore_failure_attributes_remaining_not_executed_cases',
    'test_bootstrap_failure_preserves_all_declared_not_executed_cases'}
  names=unittest.defaultTestLoader.getTestCaseNames(module.HarnessRegression);assert set(names)==expected
  result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(module))
  receipt={'scope':'controlled actual test-adapter process readiness and actual test-driver evidence/phase controller; not systemd or native app acceptance','cases':names,'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skips':len(result.skipped),'sourceSHA256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.glob('*.py'))}}
  pathlib.Path(sys.argv[1],'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
  assert result.testsRun==len(expected) and result.wasSuccessful() and not result.skipped
  PY
''
