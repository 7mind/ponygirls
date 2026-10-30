"""Behavioral-Active Blackbox-Atomic/Group contracts; specified origin."""
import copy
import json
from pathlib import Path
import sys
import unittest
import os
import socket
import subprocess
import tempfile
import threading
import time
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import evaluate
import bridge


class ScorerContract(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads((ROOT / 'fixtures.json').read_text())
        self.task = self.fixture['tasks'][0]
        self.view = {'revision': 1, 'generationId': 'generation-1'}
        self.catalog = {d['id']: {'sessionId': d['id'], 'view': self.view} for d in self.fixture['documents']}
        self.answer = {'taskId': self.task['id'], 'facts': self.task['facts'], 'abstain': False,
                       'citations': [{'sessionId': 'copper', 'view': self.view, 'messageId': 'decision',
                                      'quote': self.task['evidence'][0]['quote']}]}
        self.trace = [{'taskId': self.task['id'], 'tool': 'search_sessions', 'arguments': {'query': self.task['query'], 'offset': 0},
                       'result': {'hits': [{'session': {'id': 'copper-old'}}, {'session': {'id': 'copper'}}]}},
                      {'taskId': self.task['id'], 'tool': 'get_messages', 'arguments': {'sessionId': 'copper', **self.view},
                       'result': {'view': self.view, 'messages': self.fixture['documents'][0]['messages']}}]

    def score(self):
        return evaluate.score(self.fixture, self.catalog, self.task, self.answer, self.trace, 5)

    def test_supported_exact_fact_and_rank_are_separate(self):
        result = self.score()
        self.assertTrue(result['answerSuccess'])
        self.assertEqual(result['recallAtK'], 1)
        self.assertEqual(result['mrr'], .5)
        self.trace = self.trace[1:]
        self.assertTrue(self.score()['answerSuccess'])
        self.assertEqual(self.score()['recallAtK'], 0)

    def test_negative_controls(self):
        controls = []
        wrong = copy.deepcopy(self.answer); wrong['facts']['port'] = '9411'; controls.append((wrong, self.trace))
        wrong = copy.deepcopy(self.answer); wrong['citations'][0]['quote'] = 'port 9999'; controls.append((wrong, self.trace))
        wrong = copy.deepcopy(self.answer); wrong['citations'][0]['view'] = {'revision': 2, 'generationId': 'stale'}; controls.append((wrong, self.trace))
        wrong = copy.deepcopy(self.answer); wrong['citations'][0]['messageId'] = 'invented'; controls.append((wrong, self.trace))
        wrong = copy.deepcopy(self.answer); wrong['citations'] = []; controls.append((wrong, self.trace))
        controls.append((self.answer, []))
        controls.append(({'taskId': self.task['id'], 'outcome': 'Completed', 'facts': {}, 'abstain': False, 'citations': []}, self.trace))
        for answer, trace in controls:
            with self.subTest(answer=answer, trace=trace):
                self.assertFalse(evaluate.score(self.fixture, self.catalog, self.task, answer, trace, 5)['answerSuccess'])

    def test_absent_and_unauthorized_are_not_recall_credit(self):
        for task in self.fixture['tasks'][-2:]:
            answer = {'taskId': task['id'], 'facts': {}, 'abstain': True, 'citations': []}
            result = evaluate.score(self.fixture, self.catalog, task, answer, [], 5)
            self.assertTrue(result['answerSuccess'])
            self.assertIsNone(result['recallAtK'])
        task = self.fixture['tasks'][-1]
        trace = [{'taskId': task['id'], 'tool': 'search_sessions', 'arguments': {'query': task['query']}, 'result': {'hits': [{'session': {'id': 'private'}}]}}]
        result = evaluate.score(self.fixture, self.catalog, task, answer, trace, 5)
        self.assertTrue(result['aclLeak'])
        self.assertFalse(result['answerSuccess'])

    def test_citation_must_be_verbatim_source_not_canonically_equivalent(self):
        source = 'The cafe\u0301 uses port 4317.'
        self.fixture['documents'][0]['messages'][0]['text'] = source
        self.task['evidence'][0]['quote'] = source
        self.answer['citations'][0]['quote'] = 'The caf\u00e9 uses port 4317.'
        self.assertFalse(self.score()['answerSuccess'])
        self.answer['citations'][0]['quote'] = source
        self.assertTrue(self.score()['answerSuccess'])

    def test_private_hit_invalidates_every_reader_task(self):
        self.trace[0]['result']['hits'].append({'session': {'id': 'private'}})
        self.assertTrue(self.score()['aclLeak'])
        self.assertFalse(self.score()['answerSuccess'])

    def test_fixture_evidence_and_pagination(self):
        documents = {d['id']: d for d in self.fixture['documents']}
        for task in self.fixture['tasks']:
            for evidence in task['evidence']:
                messages = evaluate.messages(documents[evidence['document']])
                message = next(m for m in messages if m['id'] == evidence['messageId'])
                self.assertIn(evidence['quote'], message['text'])
        self.assertGreater(len(evaluate.messages(documents['pagination'])), 100)
        self.assertEqual({t['split'] for t in self.fixture['tasks']}, {'dev', 'holdout'})


class MemoryRead:
    def call(self, name, args, principal):
        if name != 'get_messages' or principal != 'reader' or args['sessionId'] != 'owned':
            raise ValueError('unauthorized dummy read')
        source = [{'id': str(n), 'text': str(n)} for n in range(103)]
        return {'view': {'revision': 1, 'generationId': 'g'}, 'offset': args['offset'], 'total': len(source),
                'messages': source[args['offset']:args['offset'] + args['limit']]}


class BridgeContract(unittest.TestCase):
    def test_search_tags_decodes_recorded_native_facets_variant_over_owned_http(self):
        """Replay list_facets wire, not a tag RPC; both use generated Result.Facets."""
        fixture = evaluate.load(ROOT / 'tests/data/recorded-native-facets-tool-content.json')
        self.assertEqual(fixture['provenance']['actualProducerTool'], 'list_facets')
        content = json.loads(fixture['toolContentJson'])
        wrapper = json.loads(content['content'][0]['text'])
        self.assertEqual(list(wrapper), ['Facets'])
        expected = wrapper['Facets']['result']
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                requests.append(payload['params']['name'])
                data = json.dumps({'jsonrpc': '2.0', 'id': payload['id'], 'result': content}).encode()
                self.send_response(200); self.send_header('Content-Length', str(len(data))); self.end_headers()
                self.wfile.write(data)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary); token = directory / 'token'; token.write_text('synthetic-facets-token'); token.chmod(0o600)
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .01}); thread.start()
            try:
                executable = Path('/proc/self/exe').resolve()
                manifest = {'origin': f'http://127.0.0.1:{server.server_port}', 'pid': os.getpid(),
                            'executable': str(executable), 'elfSha256': evaluate.digest(executable), 'tokenFiles': {'reader': str(token)}}
                adapter = bridge.Bridge(manifest, directory, 'facets-wire', False, search_mode='lexical', related_policy='deny')
                try:
                    self.assertEqual(adapter.call('list_facets', {}, 'reader'), expected)
                    self.assertEqual(adapter.call('search_tags', {'query': '', 'limit': 20}, 'reader'), expected)
                finally:
                    adapter.close()
                self.assertEqual(requests, ['list_facets', 'search_tags'])
                trace = (directory / 'trace.jsonl').read_text()
                self.assertNotIn(token.read_text(), trace)
                self.assertNotIn('Authorization', trace)
            finally:
                server.shutdown(); thread.join(); server.server_close()

    def test_paging_contract_memory_and_loopback_http(self):
        dummy = MemoryRead()
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                params = payload['params']
                if params['arguments'].get('query') == 'redirect':
                    self.send_response(302); self.send_header('Location', 'https://example.invalid/'); self.end_headers(); return
                result = dummy.call(params['name'], params['arguments'], 'reader')
                content = {'Messages': {'result': result}}
                data = json.dumps({'jsonrpc': '2.0', 'id': payload['id'], 'result': {'isError': False,
                                  'content': [{'type': 'text', 'text': json.dumps(content)}]}}).encode()
                self.send_response(200); self.send_header('Content-Length', str(len(data))); self.end_headers()
                try:
                    if params['arguments'].get('limit') == 1:
                        for byte in data:
                            self.wfile.write(bytes([byte])); self.wfile.flush(); time.sleep(.005)
                    else:
                        self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary); token = directory / 'token'; token.write_text('synthetic-token-never-log'); token.chmod(0o600)
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .01}); thread.start()
            try:
                executable = Path('/proc/self/exe').resolve()
                manifest = {'origin': f'http://127.0.0.1:{server.server_port}', 'pid': os.getpid(),
                            'executable': str(executable), 'elfSha256': evaluate.digest(executable), 'tokenFiles': {'reader': str(token)}}
                adapter = bridge.Bridge(manifest, directory, 'paging', False, search_mode='lexical', related_policy='deny')
                try:
                    for reader in (dummy, adapter):
                        with self.subTest(adapter=type(reader).__name__):
                            actual = bridge.read_messages(reader, 'owned', {'revision': 1, 'generationId': 'g'}, 'reader')
                            self.assertEqual([m['id'] for m in actual], [str(n) for n in range(103)])
                    with self.assertRaises(ValueError):
                        adapter.call('search_sessions', {'mode': 'semantic'}, 'reader')
                    with self.assertRaises(ValueError):
                        adapter.call('delete_everything', {}, 'reader')
                    with self.assertRaises(ValueError):
                        adapter.call('search_sessions', {'query': 'redirect', 'mode': 'lexical'}, 'reader')
                finally:
                    adapter.close()
                trace = (directory / 'trace.jsonl').read_text()
                self.assertNotIn(token.read_text(), trace)
                self.assertNotIn('Authorization', trace)
                slow_directory = directory / 'slow'; slow_directory.mkdir()
                with patch.object(bridge, 'TOTAL_SECONDS', .03):
                    slow = bridge.Bridge(manifest, slow_directory, 'deadline', False, search_mode='lexical', related_policy='deny')
                    try:
                        with self.assertRaises(TimeoutError):
                            slow.call('get_messages', {'sessionId': 'owned', 'offset': 0, 'limit': 1}, 'reader')
                    finally:
                        slow.close()
            finally:
                server.shutdown(); thread.join(); server.server_close()

    def test_listener_address_must_match_manifest_destination(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.2', 0)); listener.listen()
            executable = Path('/proc/self/exe').resolve()
            manifest = {'origin': f'http://127.0.0.1:{listener.getsockname()[1]}', 'pid': os.getpid(),
                        'executable': str(executable), 'elfSha256': evaluate.digest(executable)}
            with self.assertRaises(ValueError):
                bridge.ownership(manifest)

    def test_ipv4_mapped_ipv6_listener_and_negative_controls(self):
        executable = Path('/proc/self/exe').resolve()
        for bound, accepted in (('::ffff:127.0.0.1', True), ('::ffff:127.0.0.2', False), ('::', False)):
            with self.subTest(bound=bound), socket.socket(socket.AF_INET6) as listener:
                listener.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
                listener.bind((bound, 0)); listener.listen()
                port = listener.getsockname()[1]
                manifest = {'origin': f'http://127.0.0.1:{port}', 'pid': os.getpid(), 'executable': str(executable),
                            'elfSha256': evaluate.digest(executable)}
                if accepted:
                    with socket.create_connection(('127.0.0.1', port), timeout=1) as client:
                        client.sendall(b'GET / HTTP/1.0\r\n\r\n')
                        peer, _ = listener.accept()
                        with peer:
                            self.assertTrue(peer.recv(128).startswith(b'GET /'))
                            peer.sendall(b'HTTP/1.0 200 OK\r\nContent-Length: 0\r\n\r\n')
                        self.assertTrue(client.recv(128).startswith(b'HTTP/1.0 200'))
                    bridge.ownership(manifest)
                else:
                    with self.assertRaises(ValueError):
                        bridge.ownership(manifest)
        child = subprocess.Popen([sys.executable, '-c', "import socket,select; s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(); print(s.getsockname()[1],flush=True); select.select([s],[],[],5)"], stdout=subprocess.PIPE, text=True)
        try:
            manifest['origin'] = 'http://127.0.0.1:' + child.stdout.readline().strip()
            with self.assertRaises(ValueError):
                bridge.ownership(manifest)
        finally:
            child.terminate(); child.wait(2); child.stdout.close()

    def test_origin_guard(self):
        for origin in ('http://localhost:1234', 'https://127.0.0.1:1234', 'http://10.0.0.1:1234',
                       'http://127.0.0.1:1234/path', 'http://user:pass@127.0.0.1:1234', 'http://127.0.0.1:1234/?secret=x'):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                bridge.loopback(origin)
        self.assertEqual(bridge.loopback('http://127.0.0.1:1234'), 1234)


if __name__ == '__main__':
    unittest.main()
