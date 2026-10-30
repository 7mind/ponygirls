"""Behavioral-Active Blackbox-Atomic; CLI Effectual-Atomic. Specified origin except noted."""
import copy
from decimal import Decimal, localcontext
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import search_diagnostics_report as report


def identifier(number):
    return f'00000000-0000-0000-0000-{number:012x}'


def example():
    rows = []
    for n, lex, distance, half, lr, vr, session_rank in (
            (1, 0.0, .1, .4, 3, 1, 1), (2, .6, .3, .2, 1, 3, 3), (3, .2, .2, .1, 2, 2, 2)):
        rows.append({'id': identifier(n), 'sessionId': identifier(100 + n), 'generation': identifier(200 + n),
                     'revision': 1, 'lex': lex, 'distance': distance, 'halfDistance': half,
                     'lr': lr, 'vr': vr, 'score': 1 - distance, 'scoreExact': str(1 - distance), 'sessionWinner': True, 'sessionRank': session_rank})
    production = copy.deepcopy(rows)
    for row, ann, lexical, session_rank in zip(production, (True, False, True), (False, True, False), (3, 1, 2)):
        row.update(annMember=ann, lexicalMember=lexical, sessionRank=session_rank)
        row['lexRrf'] = 1 / (60 + row['lr']) if row['lex'] > 0 else 0
        row['vectorRrf'] = 1 / (60 + row['vr'])
        row['score'] = row['lexRrf'] + row['vectorRrf']
        row['scoreExact'] = str(row['score'])
    case = {'namespace': 'specified.hybrid', 'caseId': 'q', 'principal': 'db-reader', 'evaluatorPrincipal': 'reader',
            'searchQuery': {'query': 'fixed input', 'mode': 'Hybrid'}, 'corpusCount': 3,
            'exhaustive': rows, 'production': production,
            'catalog': [{'documentId': f'd{n}', 'sessionId': identifier(100 + n), 'generation': identifier(200 + n), 'revision': 1}
                        for n in (1, 2, 3)]}
    task = {'id': 'q', 'principal': 'reader', 'query': 'fixed input', 'relevant': ['d1']}
    return case, task


class DiagnosticReportContract(unittest.TestCase):
    def test_four_layers_distinguish_precision_and_budget_from_final_union_formula(self):
        case, task = example()
        result = report.report_case(case, task, 2, 60)
        self.assertEqual(result['metrics']['exhaustiveFullCosine']['recallAt5'], 1)
        self.assertEqual(result['metrics']['exactFullCosineChunkBudget']['recallAt5'], 1)
        self.assertEqual(result['metrics']['exactNormalizedHalfvecChunkBudgetFullRerank']['recallAt5'], 0)
        self.assertEqual(result['metrics']['productionAnnOnlyFullRerank']['recallAt5'], 1)
        self.assertEqual(result['layers']['productionActualUnionFormula'][0]['documentId'], 'd2')
        self.assertEqual(result['layers']['capturedUnionSimpleCosine'][0]['documentId'], 'd1')
        self.assertTrue(result['formulaVerified'])

    def test_actual_formula_is_not_membership_rrf(self):
        case, task = example()
        result = report.report_case(case, task, 2, 60)
        current = {r['documentId']: r['score'] for r in result['layers']['productionActualUnionFormula']}
        membership = {r['documentId']: r['score'] for r in result['layers']['capturedMembershipRrf']}
        self.assertAlmostEqual(current['d2'], 1 / 61 + 1 / 63)  # lexical-only gets vector term
        self.assertAlmostEqual(current['d3'], 2 / 62)  # ANN-only with positive lex gets lexical term
        self.assertAlmostEqual(current['d1'], 1 / 61)  # zero lex gets no lexical term
        self.assertAlmostEqual(membership['d2'], 1 / 61)
        self.assertAlmostEqual(membership['d3'], 1 / 62)

    def test_chunk_budget_can_remove_a_session_before_session_deduplication(self):
        case, _ = example()
        rows = copy.deepcopy(case['exhaustive'])
        rows[2]['sessionId'] = rows[0]['sessionId']
        selected, _ = report.exact_window(rows, 'distance', 2)
        self.assertEqual(len(report.cosine_ranking(rows)), 2)
        self.assertEqual(len(report.cosine_ranking(selected)), 1)

    def test_budget_boundary_ties_are_explicit_not_unobserved_ann_ordinals(self):
        case, task = example()
        for row in case['exhaustive'] + case['production']:
            row['halfDistance'] = .2
        result = report.report_case(case, task, 2, 60)
        boundary = result['halfvecBudgetBoundary']
        self.assertTrue(boundary['tieCrossesBudget'])
        self.assertEqual(len(boundary['tiedChunkIds']), 3)
        comparison = result['annVersusExactHalfvec']
        self.assertEqual(comparison['missingDeterministicReferenceIds'], [identifier(2)])
        self.assertEqual(comparison['missingStrictlyBetterThanBoundaryIds'], [])
        self.assertEqual(comparison['outsideBoundaryTieEligibleIds'], [])

    def test_strict_boundary_miss_is_reported(self):
        case, task = example()
        for row in case['exhaustive'] + case['production']:
            row['halfDistance'] = {identifier(1): .1, identifier(2): .2, identifier(3): .3}[row['id']]
        # Replace ANN membership with only the inferior C chunk; lexical still supplies B.
        case['production'][0]['annMember'] = False
        case['production'][0]['lexicalMember'] = True
        result = report.report_case(case, task, 2, 60)
        self.assertEqual(result['annVersusExactHalfvec']['missingStrictlyBetterThanBoundaryIds'], [identifier(1)])
        self.assertEqual(result['annVersusExactHalfvec']['outsideBoundaryTieEligibleIds'], [identifier(3)])

    def test_semantic_uses_actual_cosine_score_not_rrf(self):
        case, task = example()
        case['searchQuery']['mode'] = 'Semantic'
        for row, oracle in zip(case['production'], case['exhaustive']):
            row.update(annMember=True, lexicalMember=False, score=oracle['score'], scoreExact=oracle['scoreExact'], sessionRank=oracle['sessionRank'])
        result = report.report_case(case, task, 3, 60)
        self.assertEqual(result['layers']['productionActualUnionFormula'][0]['documentId'], 'd1')

    def test_score_rank_winner_and_binding_tampering_fail_fast(self):
        for key, value in (('score', .9), ('lr', 2), ('vr', 2), ('lexRrf', .5), ('vectorRrf', .5),
                           ('sessionWinner', False), ('sessionRank', 3), ('generation', identifier(999)), ('distance', .9)):
            with self.subTest(key=key):
                case, task = example()
                case['production'][1][key] = value
                with self.assertRaises(ValueError):
                    report.report_case(case, task, 2, 60)

    def test_negative_cases_have_null_recall_not_abstention_credit(self):
        case, task = example()
        task['relevant'] = []
        result = report.report_case(case, task, 2, 60)
        for metrics in result['metrics'].values():
            self.assertIsNone(metrics['recallAt5'])

    def test_visible_forbidden_document_is_rejected(self):
        case, task = example()
        task['relevant'] = []
        task['forbidden'] = ['d2']
        with self.assertRaisesRegex(ValueError, 'forbidden'):
            report.report_case(case, task, 2, 60)

    def test_nonfinite_duplicate_and_noncanonical_rows_rejected(self):
        case, _ = example()
        for bad in (case['exhaustive'] + [case['exhaustive'][0]],
                    [dict(case['exhaustive'][0], distance=math.nan)],
                    [dict(case['exhaustive'][0], id=identifier(10).upper())]):
            with self.subTest(rows=bad), self.assertRaises(ValueError):
                report.validate_rows(bad)

    def test_uuid_ties_have_declared_chunk_then_session_order(self):
        rows = [{'id': identifier(n), 'sessionId': identifier(session), 'distance': .1}
                for n, session in ((3, 102), (2, 101), (1, 101))]
        result = report.cosine_ranking(rows)
        self.assertEqual([r['chunkId'] for r in result], [identifier(1), identifier(3)])

    def test_postgres_numeric_rrf_ties_are_not_split_by_binary_recomputation(self):
        # regression: 1/61+1/549 == 1/63+1/427, but their binary sums differ.
        count = 489
        vector_positions = [489, 1, 367] + [n for n in range(1, count + 1) if n not in (489, 1, 367)]
        rows = []
        with localcontext() as context:
            context.prec = 60
            for lr, vr in enumerate(vector_positions, 1):
                score = (Decimal(1) / (60 + lr)).quantize(Decimal('1e-20')) + (Decimal(1) / (60 + vr)).quantize(Decimal('1e-20'))
                # Give lexical rank 3 the smaller session UUID, the SQL tie winner.
                sid = 1 if lr == 3 else lr + 1
                rows.append({'id': identifier(lr), 'sessionId': identifier(sid), 'lex': count - lr + 1,
                             'distance': vr / count, 'lr': lr, 'vr': vr, 'score': float(score), 'scoreExact': str(score),
                             'sessionWinner': True})
        expected = sorted(rows, key=lambda row: (-Decimal(row['scoreExact']), row['sessionId']))
        for rank, row in enumerate(expected, 1):
            row['sessionRank'] = rank
        self.assertEqual(rows[0]['scoreExact'], rows[2]['scoreExact'])
        self.assertNotEqual(1 / 61 + 1 / 549, 1 / 63 + 1 / 427)
        actual = report.verify_scores(rows, 'Hybrid', 60, False)
        self.assertEqual([row['sessionId'] for row in actual], [row['sessionId'] for row in expected])

    def test_membership_rrf_preserves_rational_ties_and_exposes_exact_scores(self):
        # regression: binary sums split the exact tie 1/61+1/549 == 1/63+1/427.
        count = 489
        vector_positions = [489, 1, 367] + [n for n in range(1, count + 1) if n not in (489, 1, 367)]
        corpus, production, catalog = [], [], []
        with localcontext() as context:
            context.prec = 60
            for lr, vr in enumerate(vector_positions, 1):
                sid = 1 if lr == 3 else lr + 1
                row = {'id': identifier(lr), 'sessionId': identifier(sid), 'generation': identifier(1000 + lr),
                       'revision': 1, 'lex': count - lr + 1, 'distance': vr / count, 'halfDistance': vr / count,
                       'lr': lr, 'vr': vr, 'sessionWinner': True, 'sessionRank': vr}
                row.update(score=1 - row['distance'], scoreExact=str(1 - row['distance']))
                corpus.append(row)
                lex_rrf = (Decimal(1) / (60 + lr)).quantize(Decimal('1e-20'))
                vector_rrf = (Decimal(1) / (60 + vr)).quantize(Decimal('1e-20'))
                production.append(dict(row, annMember=True, lexicalMember=True, lexRrf=float(lex_rrf),
                                       vectorRrf=float(vector_rrf), score=float(lex_rrf + vector_rrf),
                                       scoreExact=str(lex_rrf + vector_rrf)))
                catalog.append({'documentId': f'd{lr}', 'sessionId': row['sessionId']})
        for rank, row in enumerate(sorted(production, key=lambda r: (-Decimal(r['scoreExact']), r['sessionId'])), 1):
            row['sessionRank'] = rank
        case, task = example()
        case.update(exhaustive=corpus, production=production, corpusCount=count, catalog=catalog)
        task['relevant'] = ['d1']
        expected = {row['id']: Fraction(1, 60 + row['lr']) + Fraction(1, 60 + row['vr']) for row in production}
        self.assertEqual(expected[identifier(1)], expected[identifier(3)])
        self.assertNotEqual(1 / 61 + 1 / 549, 1 / 63 + 1 / 427)
        sessions = report.report_case(case, task, count, 60)['layers']['capturedMembershipRrf']
        tied = [session for session in sessions if session['chunkId'] in (identifier(1), identifier(3))]
        self.assertEqual([session['chunkId'] for session in tied], [identifier(3), identifier(1)])
        for session in sessions:
            exact = expected[session['chunkId']]
            self.assertEqual(session['scoreRational'], {'numerator': exact.numerator, 'denominator': exact.denominator})
            self.assertEqual(session['scoreExact'], str(exact))
            self.assertEqual(session['score'], float(exact))
        # The same exact score selects the smaller chunk UUID within one session.
        one_session = [dict(row, sessionId=identifier(1)) for row in production if row['id'] in (identifier(1), identifier(3))]
        winner = report.session_ranking(one_session, expected)
        self.assertEqual(winner[0]['chunkId'], identifier(1))

    def test_empty_corpus_is_explicit_and_has_no_boundary(self):
        case, task = example()
        case.update(exhaustive=[], production=[], corpusCount=0)
        result = report.report_case(case, task, 2, 60)
        self.assertEqual(result['corpusChunks'], 0)
        self.assertIsNone(result['halfvecBudgetBoundary']['distance'])
        self.assertEqual(result['metrics']['exhaustiveFullCosine']['recallAt5'], 0)

    def test_cli_preserves_existing_output_and_checks_exact_fixture_bytes(self):
        case, task = example()
        fixture_bytes = json.dumps({'tasks': [task]}).encode()
        capture = {'schemaVersion': 1, 'readOnly': True, 'isolation': 'repeatable read', 'snapshot': '1:2:',
                   'fixtureSha256': hashlib.sha256(fixture_bytes).hexdigest(), 'requestSha256': 'test-request',
                   'candidateBudget': 2, 'rrfConstant': 60, 'cases': [case]}
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix='.diagnostics-test-', dir=root) as directory:
            directory = Path(directory)
            fixture, source, output = (directory / name for name in ('fixture.json', 'capture.json', 'report.json'))
            fixture.write_bytes(fixture_bytes)
            source.write_text(json.dumps(capture))
            command = [sys.executable, str(root / 'search_diagnostics_report.py'), '--capture', str(source),
                       '--fixture', str(fixture), '--output', str(output)]
            first = subprocess.run(command, capture_output=True, text=True, timeout=10)
            self.assertEqual(first.returncode, 0, first.stderr)
            first_bytes = output.read_bytes()
            self.assertTrue(json.loads(first_bytes)['cases'][0]['formulaVerified'])
            second = subprocess.run(command, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual(first_bytes, output.read_bytes())
            output.unlink()
            fixture.write_bytes(fixture_bytes + b' ')
            third = subprocess.run(command, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(third.returncode, 0)
            self.assertIn('fixture digest differs', third.stderr)
            self.assertFalse(output.exists())

    def test_fixed_evaluator_query_is_bound(self):
        case, task = example()
        case['searchQuery']['query'] = 'different query'
        with self.assertRaises(ValueError):
            report.report_case(case, task, 2, 60)


if __name__ == '__main__':
    unittest.main()
