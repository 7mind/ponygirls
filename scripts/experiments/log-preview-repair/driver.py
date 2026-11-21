"""Inside bubblewrap only. Load the selected original tests and run unittest -v."""

import errno
from functools import partial
import importlib
import importlib.util
import inspect
import json
import resource
import sys
from types import SimpleNamespace
import unittest


# No further processes/threads are needed by the selected tests. RLIMIT_NPROC
# is set inside the new user/PID namespaces, with no capabilities, before imports.
resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
sys.path[:0] = ['/project/src', '/project']


def raises(exception, *, match=None):
    test = unittest.TestCase()
    return test.assertRaises(exception) if match is None else test.assertRaisesRegex(exception, match)


def parametrize(names, values):
    def decorate(fn):
        assert not hasattr(fn, 'params') and list(inspect.signature(fn).parameters) == [
            x.strip() for x in names.split(',')]
        fn.params = [v if ',' in names else (v,) for v in values]
        return fn
    return decorate


def function_tests(module_name):
    # Keep test bodies verbatim: pytest-style module functions -> unittest;
    # no patching targets, rewriting asserts, or inserting synthetic log rows.
    mod = importlib.import_module(module_name)
    methods = {'__module__': mod.__name__}
    for name, fn in inspect.getmembers(mod, inspect.isfunction):
        if fn.__module__ != mod.__name__ or not name.startswith('test_'):
            continue
        if hasattr(fn, 'params'):
            for i, row in enumerate(fn.params):
                methods[f'{name}_{i:02}'] = staticmethod(partial(fn, *row))
        else:
            assert not inspect.signature(fn).parameters
            methods[name] = staticmethod(fn)
    return unittest.defaultTestLoader.loadTestsFromTestCase(type('Functions', (unittest.TestCase,), methods))


def suite(case_id, phase):
    if phase == 'heldout':
        # Do not put evaluator modules on the application's import path.
        spec = importlib.util.spec_from_file_location('_check_edges', '/suite/heldout.py')
        checks = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(checks)
        return unittest.defaultTestLoader.loadTestsFromTestCase(checks.EDGE_TESTS[case_id])
    if case_id == 'case-a':
        return function_tests('toolz.tests.test_itertoolz')
    if case_id == 'case-b':
        mod = importlib.import_module('tests.test_more')
        return unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls) for cls in
                                  (mod.GroupByTransformTests, mod.NumericRangeTests, mod.CountCycleTests))
    assert case_id == 'case-c' and phase == 'public'
    # Adapter for exactly the two pytest features in the selected modules;
    # no application dependency on pytest/third-party test plugins.
    sys.modules['pytest'] = SimpleNamespace(mark=SimpleNamespace(parametrize=parametrize), raises=raises)
    return unittest.TestSuite(function_tests('tests.' + name) for name in ('test_format', 'test_index'))


def constrained(exception):
    return (isinstance(exception, MemoryError) or
            isinstance(exception, OSError) and exception.errno in
            {errno.EAGAIN, errno.EFBIG, errno.EMFILE, errno.ENOMEM, errno.ENOSPC})


class Audit(unittest.TextTestResult):
    """Account for subtest errors too. stopTest counts completed TestCase methods."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.completed = self.passed = 0
        self.resource_error = False
        self.issues = []

    def stopTest(self, test):
        self.completed += 1
        super().stopTest(test)

    def addSuccess(self, test):
        self.passed += 1
        super().addSuccess(test)

    def record(self, test, err):
        self.resource_error |= constrained(err[1])
        self.issues.append([test.id().rsplit('.', 1)[-1], type(err[1]).__name__])

    def addError(self, test, err):
        self.record(test, err)
        super().addError(test, err)

    def addFailure(self, test, err):
        self.record(test, err)
        super().addFailure(test, err)

    def addSubTest(self, test, subtest, err):
        if err:
            self.record(test, err)
        super().addSubTest(test, subtest, err)


def main():
    try:
        tests = suite(*sys.argv[1:])
    except Exception as exc:
        print('SUITE_RECEIPT ' + json.dumps({'status': 'resource' if constrained(exc) else 'collection'}))
        return 2
    planned = tests.countTestCases()
    result = unittest.TextTestRunner(stream=sys.stdout, verbosity=2, descriptions=False,
                                     resultclass=Audit).run(tests)
    extras = len(result.skipped) + len(result.expectedFailures) + len(result.unexpectedSuccesses)
    ok = bool(planned and planned == result.testsRun == result.completed == result.passed
              and not extras and result.wasSuccessful())
    print('SUITE_RECEIPT ' + json.dumps(dict(
        status='finished', planned=planned, ran=result.testsRun, completed=result.completed,
        passed=result.passed, errors=len(result.errors), failures=len(result.failures), extras=extras,
        resource=result.resource_error, issues=result.issues,
    ), ensure_ascii=True, allow_nan=False, separators=(',', ':')))
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
