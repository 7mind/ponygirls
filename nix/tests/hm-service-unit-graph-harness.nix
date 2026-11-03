{ pkgs }:
pkgs.runCommand "hm-unit-graph-explicit-context-contract" {
  nativeBuildInputs=[pkgs.python3 pkgs.python3Packages.mypy];
} ''
  mkdir source "$out"
  cp ${./hm-service-unit-graph-vm.py} source/hm-service-unit-graph-vm.py
  cp ${./hm-service-unit-graph-harness-test.py} source/hm-service-unit-graph-harness-test.py
  cp ${./hm-service-unit-graph-vm.nix} source/hm-service-unit-graph-vm.nix
  export HM_GRAPH_TEST_SOURCE_DIR="$PWD/source"
  mypy --disallow-untyped-defs --check-untyped-defs --disallow-any-explicit --disallow-any-generics --warn-return-any source/hm-service-unit-graph-vm.py > "$out/types.log"
  python3 - "$out" <<'PY'
  import hashlib,importlib.util,json,pathlib,sys,unittest
  root=pathlib.Path('source');spec=importlib.util.spec_from_file_location('hm_contract',root/'hm-service-unit-graph-harness-test.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  expected={
    'test_constructor_dependencies_and_selection_have_no_defaults',
    'test_actual_entry_loader_rejects_none_spec_without_fallback',
    'test_actual_entry_none_loader_guard_precedes_module_creation',
    'test_instances_keep_independent_receipt_and_baseline_state',
    'test_selected_two_chains_recover_and_unselected_whole_chain_stays_inactive',
    'test_any_unselected_database_migration_or_app_activation_is_rejected',
    'test_exact_seven_case_inventory_survives_refactor'}
  names=unittest.defaultTestLoader.getTestCaseNames(module.HmFixtureContract);assert set(names)==expected
  result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(module))
  receipt={'scope':'typed explicit HM fixture context and controlled selected-chain contract; NOT user-manager/PG/native runtime acceptance','cases':names,'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skips':len(result.skipped),'sourceSHA256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.glob('*.py'))}}
  pathlib.Path(sys.argv[1],'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
  assert result.testsRun==len(expected) and result.wasSuccessful() and not result.skipped
  PY
''
