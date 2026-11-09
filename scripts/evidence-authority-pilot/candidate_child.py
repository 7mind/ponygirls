"""Input-only candidate caller. Sandbox/expected comparison live outside this process."""
import contextlib
import hashlib
import importlib.util
import json
import math
import re
import sys

INPUT_BYTES = 4194304
FUNCTION_NAME = re.compile(r'[A-Za-z][A-Za-z0-9_]*\Z')


def duplicate_guard(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate-key')
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError('nonfinite-number')


def check_data(value):
    pending = [value]
    while pending:
        item = pending.pop()
        if item is None or type(item) in (bool, int, str):
            if type(item) is str:
                item.encode('utf-8')
        elif type(item) is float:
            if not math.isfinite(item):
                raise ValueError('nonfinite-number')
        elif type(item) is list:
            pending.extend(item)
        elif type(item) is dict:
            if any(type(key) is not str for key in item):
                raise ValueError('non-string-key')
            pending.extend(item.values())
        else:
            raise ValueError('non-json-value')


def main():
    output = sys.stdout
    dumps = json.dumps
    before_arguments = None
    try:
        if len(sys.argv) != 2:
            raise ValueError('module-argument')
        body = sys.stdin.buffer.read(INPUT_BYTES + 1)
        if len(body) > INPUT_BYTES:
            raise ValueError('input-bound')
        request = json.loads(body.decode('utf-8'), object_pairs_hook=duplicate_guard, parse_constant=reject_constant)
        if type(request) is not dict or set(request) != {'function', 'args'}:
            raise ValueError('call-shape')
        if type(request['function']) is not str or FUNCTION_NAME.fullmatch(request['function']) is None or type(request['args']) is not list:
            raise ValueError('call-fields')
        check_data(request['args'])
        before_arguments = dumps(request['args'], ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    except (ValueError, TypeError, UnicodeError):
        record = {'kind': 'protocol_error', 'code': 'call-input'}
    else:
        try:
            spec = importlib.util.spec_from_file_location('_owned_candidate', sys.argv[1])
            if spec is None or spec.loader is None:
                raise ValueError('module-loader')
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            with contextlib.redirect_stdout(sys.stderr):
                spec.loader.exec_module(module)
        except BaseException:
            record = {'kind': 'candidate_error', 'code': 'load'}
        else:
            function = getattr(module, request['function'], None)
            if not callable(function):
                record = {'kind': 'candidate_error', 'code': 'missing-function'}
            else:
                try:
                    with contextlib.redirect_stdout(sys.stderr):
                        value = function(*request['args'])
                except BaseException as error:
                    record = {'kind': 'exception', 'type': type(error).__name__}
                else:
                    try:
                        dumps(value, allow_nan=False)
                        check_data(value)
                        record = {'kind': 'value', 'value': value}
                    except (TypeError, ValueError, UnicodeError):
                        record = {'kind': 'candidate_error', 'code': 'non-json-return'}
    if before_arguments is not None:
        observation = {'before_bytes': len(before_arguments), 'before_sha256': hashlib.sha256(before_arguments).hexdigest(),
                       'after_bytes': None, 'after_sha256': None, 'after_status': 'non-json', 'mutated': True}
        try:
            after_arguments = dumps(request['args'], ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
            check_data(request['args'])
            observation.update(after_bytes=len(after_arguments), after_sha256=hashlib.sha256(after_arguments).hexdigest(),
                               after_status='json', mutated=before_arguments != after_arguments)
        except (ValueError, TypeError, UnicodeError):
            pass
        record['argument_observation'] = observation
    output.write(dumps(record, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n')
    output.flush()


if __name__ == '__main__':
    main()
