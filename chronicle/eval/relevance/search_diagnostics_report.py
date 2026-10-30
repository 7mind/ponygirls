#!/usr/bin/env python3
"""Offline retrieval-loss report; never connects to a service or changes ranking."""
import argparse
from decimal import Decimal
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import uuid


def require(condition, message):
    if not condition:
        raise ValueError(message)


def ranks(rows, field, descending=False):
    ordered = sorted(rows, key=lambda row: ((-1 if descending else 1) * row[field], row['id']))
    return {row['id']: ordinal for ordinal, row in enumerate(ordered, 1)}


def session_ranking(rows, scores):
    winners = {}
    for row in rows:
        previous = winners.get(row['sessionId'])
        if previous is None or (-scores[row['id']], row['id']) < (-scores[previous['id']], previous['id']):
            winners[row['sessionId']] = row
    ordered = sorted(winners.values(), key=lambda row: (-scores[row['id']], row['sessionId']))
    return [{'sessionId': row['sessionId'], 'chunkId': row['id'], 'score': float(scores[row['id']]),
             'scoreExact': str(scores[row['id']]), 'rank': ordinal}
            for ordinal, row in enumerate(ordered, 1)]


def cosine_ranking(rows):
    return session_ranking(rows, {row['id']: 1.0 - row['distance'] for row in rows})


def exact_window(rows, field, budget):
    ordered = sorted(rows, key=lambda row: (row[field], row['id']))
    selected = ordered[:budget]
    boundary = selected[-1][field] if selected else None
    tied = [row['id'] for row in ordered if row[field] == boundary]
    return selected, {'distance': boundary, 'tiedChunkIds': tied,
                      'selectedTiedChunkIds': [row['id'] for row in selected if row[field] == boundary],
                      'tieCrossesBudget': len(ordered) > budget and ordered[budget][field] == boundary}


def validate_rows(rows):
    require(len({row['id'] for row in rows}) == len(rows), 'duplicate chunk')
    for row in rows:
        for key in ('id', 'sessionId', 'generation'):
            require(str(uuid.UUID(row[key])) == row[key], 'noncanonical UUID')
        require(type(row['revision']) is int and row['revision'] > 0, 'invalid revision')
        for key in ('lex', 'distance', 'halfDistance', 'score'):
            require(type(row[key]) in (int, float) and math.isfinite(row[key]), 'nonfinite score')


def verify_scores(rows, mode, constant, components):
    lexical = ranks(rows, 'lex', descending=True)
    vector = ranks(rows, 'distance')
    scores = {}
    for row in rows:
        require(row['lr'] == lexical[row['id']] and row['vr'] == vector[row['id']], 'captured union rank differs')
        lex_rrf = 1 / (constant + lexical[row['id']]) if row['lex'] > 0 else 0.0
        vector_rrf = 1 / (constant + vector[row['id']])
        score = 1.0 - row['distance'] if mode == 'Semantic' else lex_rrf + vector_rrf
        require(math.isclose(score, row['score'], rel_tol=1e-12, abs_tol=1e-14), 'captured formula differs')
        if components:
            require(math.isclose(lex_rrf, row['lexRrf'], rel_tol=1e-12, abs_tol=1e-14), 'lexical term differs')
            require(math.isclose(vector_rrf, row['vectorRrf'], rel_tol=1e-12, abs_tol=1e-14), 'vector term differs')
        captured = Decimal(row['scoreExact'])
        require(captured.is_finite() and math.isclose(float(captured), row['score'], rel_tol=1e-12, abs_tol=1e-14), 'exact score differs')
        scores[row['id']] = captured
    sessions = session_ranking(rows, scores)
    by_session = {row['sessionId']: row for row in sessions}
    for row in rows:
        session = by_session[row['sessionId']]
        require(type(row['sessionWinner']) is bool and row['sessionWinner'] == (session['chunkId'] == row['id']), 'session winner differs')
        require(row['sessionRank'] == session['rank'], 'session rank differs')
    return sessions


def metrics(sessions, relevant):
    return {'recallAt' + str(k): (len(relevant & {r['sessionId'] for r in sessions[:k]}) / len(relevant)
                                 if relevant else None) for k in (1, 5, 10)}


def report_case(case, task, budget, constant):
    corpus, production = case['exhaustive'], case['production']
    validate_rows(corpus)
    validate_rows(production)
    require(case['corpusCount'] == len(corpus), 'corpus count differs')
    require(case['searchQuery']['query'] == task['query'] and case['evaluatorPrincipal'] == task['principal'], 'fixed evaluator input differs')
    mode = case['searchQuery']['mode']
    require(mode in ('Semantic', 'Hybrid'), 'unsupported diagnostic mode')
    exhaustive = verify_scores(corpus, 'Semantic', constant, False)
    actual = verify_scores(production, mode, constant, True)
    by_id = {row['id']: row for row in corpus}
    for row in production:
        require(row['id'] in by_id, 'production candidate outside corpus')
        require(all(row[key] == by_id[row['id']][key] for key in ('sessionId', 'generation', 'revision', 'lex', 'distance', 'halfDistance')), 'candidate binding differs')
        require(type(row['annMember']) is bool and type(row['lexicalMember']) is bool, 'invalid membership flag')
        require(row['annMember'] or row['lexicalMember'], 'candidate belongs to neither leg')
    ann = [row for row in production if row['annMember']]
    lexical = [row for row in production if row['lexicalMember']]
    require(len(ann) <= budget and len(lexical) <= budget, 'candidate budget exceeded')
    if mode == 'Semantic' or not case['searchQuery']['query']:
        require(not lexical, 'unexpected lexical leg')
    full, full_boundary = exact_window(corpus, 'distance', budget)
    half, half_boundary = exact_window(corpus, 'halfDistance', budget)
    ann_ids = {row['id'] for row in ann}
    half_ids = {row['id'] for row in half}
    boundary = half_boundary['distance']
    strict_half_ids = {row['id'] for row in corpus if row['halfDistance'] < boundary} if boundary is not None else set()
    eligible_half_ids = {row['id'] for row in corpus if row['halfDistance'] <= boundary} if boundary is not None else set()
    # This is a distinct diagnostic policy, not a reconstruction of unobserved ANN traversal ordinals.
    ann_ranks = ranks(ann, 'distance')
    lexical_ranks = ranks(lexical, 'lex', descending=True)
    membership_scores = {row['id']: ((Fraction(1, constant + ann_ranks[row['id']]) if row['id'] in ann_ranks else Fraction(0)) +
                                    (Fraction(1, constant + lexical_ranks[row['id']]) if row['id'] in lexical_ranks else Fraction(0)))
                         for row in production}
    layers = {'exhaustiveFullCosine': exhaustive,
              'exactFullCosineChunkBudget': cosine_ranking(full),
              'exactNormalizedHalfvecChunkBudgetFullRerank': cosine_ranking(half),
              'productionAnnOnlyFullRerank': cosine_ranking(ann),
              'productionActualUnionFormula': actual,
              'capturedUnionSimpleCosine': cosine_ranking(production),
              'capturedMembershipRrf': session_ranking(production, membership_scores)}
    for session in layers['capturedMembershipRrf']:
        exact = membership_scores[session['chunkId']]
        session['scoreRational'] = {'numerator': exact.numerator, 'denominator': exact.denominator}
    catalog = {publication['documentId']: publication for publication in case['catalog']}
    require(len(catalog) == len(case['catalog']), 'duplicate document binding')
    relevant = {catalog[document]['sessionId'] for document in task['relevant']}
    forbidden = {catalog[document]['sessionId'] for document in task.get('forbidden', []) if document in catalog}
    require(not forbidden, 'forbidden evaluator document visible in authorized catalog')
    by_session = {publication['sessionId']: document for document, publication in catalog.items()}
    for sessions in layers.values():
        for session in sessions:
            session['documentId'] = by_session[session['sessionId']]
    return {'namespace': case['namespace'], 'caseId': case['caseId'], 'principal': case['principal'], 'mode': mode,
            'corpusChunks': len(corpus), 'corpusSessionsWithChunks': len(exhaustive),
            'visiblePublishedSessions': len(catalog), 'annChunks': len(ann), 'lexicalChunks': len(lexical),
            'unionChunks': len(production), 'formulaVerified': True,
            'fullCosineBudgetBoundary': full_boundary, 'halfvecBudgetBoundary': half_boundary,
            'annVersusExactHalfvec': {'missingDeterministicReferenceIds': sorted(half_ids - ann_ids),
                                    'additionalDeterministicReferenceIds': sorted(ann_ids - half_ids),
                                    'missingStrictlyBetterThanBoundaryIds': sorted(strict_half_ids - ann_ids),
                                    'outsideBoundaryTieEligibleIds': sorted(ann_ids - eligible_half_ids),
                                    'note': 'Reference id tie-break is not production ANN order. Boundary ties alone do not prove traversal loss.'},
            'metrics': {name: metrics(sessions, relevant) for name, sessions in layers.items()}, 'layers': layers}


def build_report(capture, fixture):
    require(capture['schemaVersion'] == 1 and capture['readOnly'] is True and capture['isolation'] == 'repeatable read', 'invalid capture provenance')
    tasks = {task['id']: task for task in fixture['tasks']}
    cases = [report_case(case, tasks[case['caseId']], capture['candidateBudget'], capture['rrfConstant']) for case in capture['cases']]
    require(len({case['namespace'] for case in cases}) == len(cases), 'duplicate namespace')
    return {'schemaVersion': 1, 'fixtureSha256': capture['fixtureSha256'], 'requestSha256': capture['requestSha256'],
            'snapshot': capture['snapshot'], 'cases': cases,
            'interpretation': ['Layer differences diagnose selection, not general semantic accuracy.',
                               'Actual hybrid recomputes lr/vr over the candidate union, grants vector RRF to every candidate and lexical RRF when lex>0, independent of leg membership. This is not automatically a defect.',
                               'Membership RRF uses full-cosine rerank within ANN membership and lexical score/id rank within lexical membership; it does not infer ANN traversal ordinal.',
                               'Membership RRF orders exact Fractions, then chunk/session UUIDs for ties; scoreRational and scoreExact preserve the rational value, while score is display-only binary float.',
                               'No answer synthesis or correct abstention is measured. Empty relevance sets have null recall.',
                               'Actual final ordering uses captured SQL score text (Decimal); independent binary-float formula checks use tolerance and do not redefine SQL numeric ties.',
                               'ANN membership reflects the actual SQL under the captured planner; index usage is not independently asserted.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', type=Path, required=True)
    parser.add_argument('--fixture', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    fixture_bytes = args.fixture.read_bytes()
    capture_bytes = args.capture.read_bytes()
    capture = json.loads(capture_bytes)
    require(hashlib.sha256(fixture_bytes).hexdigest() == capture['fixtureSha256'], 'fixture digest differs')
    report = build_report(capture, json.loads(fixture_bytes))
    report['captureSha256'] = hashlib.sha256(capture_bytes).hexdigest()
    with args.output.open('x') as stream:
        json.dump(report, stream, indent=2, allow_nan=False)
        stream.write('\n')


if __name__ == '__main__':
    main()
