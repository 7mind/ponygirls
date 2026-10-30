"""Behavioral-Active Blackbox-Group contracts, specified and regression origin."""
import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import bridge
import evaluate


class SemanticContracts(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads((ROOT / 'fixtures.json').read_text())
        self.fixture['factNormalization'] = 'casefold-and-collapse-whitespace-only'
        self.task = copy.deepcopy(self.fixture['tasks'][0])
        self.view = {'revision': 1, 'generationId': 'g'}
        self.catalog = {d['id']: {'sessionId': d['id'], 'view': self.view} for d in self.fixture['documents']}
        self.task.update(relevant=['private'], evidence=[], facts={'values': ['4317']}, factAliases=[['port 4317']])
        self.answer = {'taskId': self.task['id'], 'facts': {'values': ['4317']}, 'abstain': True, 'citations': []}
        self.trace = [{'taskId': self.task['id'], 'tool': 'search_sessions', 'arguments': {'mode': 'semantic'},
                       'result': {'hits': [{'session': {'id': 'private'}}]}}]

    def score(self, principal='restricted'):
        return evaluate.score_task(self.fixture, self.catalog, self.task, self.answer, self.trace, 5,
                                   principal=principal, fact_format='ordered-string-values-v1')

    def test_restricted_owner_read_is_not_a_leak(self):
        self.assertFalse(self.score()['aclLeak'])
        self.assertTrue(self.score('reader')['aclLeak'])
        self.trace[0]['result']['hits'] = [{'session': {'id': 'copper'}}]
        self.assertTrue(self.score()['aclLeak'])
        document = next(doc for doc in self.fixture['documents'] if doc['id'] == 'private')
        message = document['messages'][0]
        self.task['evidence'] = [{'document': 'private', 'messageId': message['id'], 'quote': message['text']}]
        self.answer.update(abstain=False, citations=[{'sessionId': 'private', 'view': self.view,
            'messageId': message['id'], 'quote': message['text']}])
        self.trace[0]['result']['hits'] = [{'session': {'id': 'private'}}]
        self.trace.append({'taskId': self.task['id'], 'tool': 'get_messages', 'arguments': {'sessionId': 'private'},
                           'result': {'view': self.view, 'messages': document['messages']}})
        self.assertTrue(self.score()['answerSuccess'])
        self.assertFalse(self.score('reader')['answerSuccess'])

    def test_explicit_frozen_aliases_and_order(self):
        self.answer['facts']['values'] = ['port 4317']
        self.assertTrue(self.score()['factMatch'])
        self.answer['facts']['values'] = ['4317', 'extra']
        self.assertFalse(self.score()['factMatch'])
        self.answer['facts']['values'] = ['PORT 4317']
        self.assertTrue(self.score()['factMatch'])
        self.answer['facts']['values'] = ['port:4317']
        self.assertFalse(self.score()['factMatch'])

    def test_unknown_format_and_principal_fail_closed(self):
        for principal, fmt in [('unknown', 'ordered-string-values-v1'), ('reader', 'unknown')]:
            with self.subTest(principal=principal, fmt=fmt), self.assertRaises(ValueError):
                evaluate.score_task(self.fixture, self.catalog, self.task, self.answer, self.trace, 5,
                                    principal=principal, fact_format=fmt)

    def test_explicit_mode_and_related_policy(self):
        for mode in ('lexical', 'semantic', 'hybrid'):
            bridge.validate_read('search_sessions', {'mode': mode}, mode, 'deny')
            for other in {'lexical', 'semantic', 'hybrid'} - {mode}:
                with self.assertRaises(ValueError):
                    bridge.validate_read('search_sessions', {'mode': other}, mode, 'deny')
            with self.assertRaises(ValueError):
                bridge.validate_read('related_sessions', {}, mode, 'deny')
        bridge.validate_read('related_sessions', {}, 'semantic', 'allow')
        with self.assertRaises(ValueError):
            bridge.validate_read('search_sessions', {}, 'semantic', 'deny')
        with self.assertRaises(ValueError):
            bridge.validate_read('delete_everything', {}, 'semantic', 'deny')


if __name__ == '__main__':
    unittest.main()
