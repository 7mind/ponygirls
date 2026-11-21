"""Independent behavioral edge cases. NOT mounted during failure-log capture or shown to the model."""

from itertools import count, islice
import unittest


class StreamEdges(unittest.TestCase):
    def test_exhausted_one_shot(self):
        from toolz import interpose
        sentinel = object()
        empty = iter([1])
        next(empty)
        result = interpose(sentinel, empty)
        self.assertIs(result, iter(result))
        self.assertIs(next(result, sentinel), sentinel)

    def test_single_element(self):
        from toolz import interpose
        item = object()
        self.assertEqual(list(interpose(None, iter([item]))), [item])

    def test_infinite_source(self):
        from toolz import interpose
        self.assertEqual(list(islice(interpose(None, count(6)), 5)), [6, None, 7, None, 8])

    def test_input_exception(self):
        from toolz import interpose
        def faulty():
            yield 1
            raise ValueError('source failed')
        with self.assertRaisesRegex(ValueError, 'source failed'):
            list(interpose(0, faulty()))


class RangeEdges(unittest.TestCase):
    def test_large_negative_domain(self):
        from more_itertools import numeric_range
        n = 10**40
        a, b = numeric_range(-n, n, 3), numeric_range(-n, n + 1, 3)
        self.assertEqual(a == b, range(-n, n, 3) == range(-n, n + 1, 3))

    def test_large_dictionary_key(self):
        from more_itertools import numeric_range
        n = 10**45
        a, b = numeric_range(n, 0, -4), numeric_range(n, 2, -4)
        self.assertEqual({a: 7}[b], 7)
        self.assertEqual(hash(a), hash(range(n, 0, -4)))
        with self.assertRaises(OverflowError):
            len(a)

    def test_large_different_sequences(self):
        from more_itertools import numeric_range
        n = 10**40
        self.assertNotEqual(numeric_range(2, n, 5), numeric_range(3, n + 1, 5))

    def test_short_equal_sequences(self):
        from more_itertools import numeric_range
        self.assertEqual(numeric_range(10, 13, 8), numeric_range(10, 14, 4))
        self.assertEqual(hash(numeric_range(-4, -4)), hash(range(0)))


class Offset:
    def __init__(self, n):
        self.n = n

    def __index__(self):
        return self.n


class VersionEdges(unittest.TestCase):
    def test_optional_parts_and_stride(self):
        from semver import Version
        version = Version.parse('3.4.5-dev+linux')
        self.assertEqual(version[Offset(4)], 'linux')
        self.assertEqual(version[Offset(1):Offset(5):Offset(2)], (4, 'dev'))

    def test_negative_protocol_bound(self):
        from semver import Version
        with self.assertRaises(IndexError):
            Version.parse('1.0.2')[:Offset(-2)]

    def test_integer_coercion_is_not_an_offset(self):
        from semver import Version
        class Number:
            def __int__(self):
                return 1
        with self.assertRaises(TypeError):
            Version.parse('2.0.1')[Number()]

    def test_undefined_optional_component(self):
        from semver import Version
        with self.assertRaisesRegex(IndexError, 'Version part undefined'):
            Version.parse('5.1.2')[3:5]


EDGE_TESTS = {'case-a': StreamEdges, 'case-b': RangeEdges, 'case-c': VersionEdges}
