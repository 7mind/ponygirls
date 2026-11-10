"""Behavioral contract runs over dummy and owned HTTP fixture; no real model."""
from contextlib import contextmanager
from dataclasses import replace
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import threading
import time
import unittest

from clef_decisions import (MODEL, Answer, Binding, Capture, DecisionBatch, DecisionClient,
    HttpResult, InputTooLarge, InvalidDecision, Limits, LoopbackTransport, Option,
    Question, assess, pieces, prepare)

class CharacterTokenizer:
    def encode(self, text, *, add_special_tokens):
        assert add_special_tokens is False
        return list(text.encode())


def fixture():
    evidence = 'Captured tool result: exit status 0. The worker claims all work is accepted.'
    binding = Binding('synthetic-scope', 'event-1', 0, 'candidates-1', 'schema-1', hashlib.sha256(evidence.encode()).hexdigest())
    question = Question('kind', 'Classify the supplied proposition.', (Option('claim', 'A model assertion.'), Option('observation', 'Captured observation of an event.')))
    return DecisionBatch(binding, evidence, (question,))


def response(prepared):
    return {'model': MODEL, 'answers': {'kind': {'type': 'choice', 'choice': 'claim', 'probabilities': {'claim': .8, 'observation': .2}, 'confidence': .6}}, 'usage': {'input_tokens': prepared.untruncated_input_tokens, 'output_tokens': 0}}

class DummyTransport:
    def __init__(self, body, status, error):
        self.body, self.status, self.error = body, status, error
        self.sent = []
    def send(self, body):
        self.sent.append(body)
        return HttpResult(self.status, self.body, 1, self.error)

@contextmanager
def owned_http(body, status, trickle_seconds):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_POST(self):
            self.rfile.read(int(self.headers['Content-Length']))
            self.send_response(status)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Connection', 'close')
            self.end_headers()
            try:
                if trickle_seconds:
                    for byte in body:
                        self.wfile.write(bytes([byte])); self.wfile.flush(); time.sleep(trickle_seconds)
                else:
                    self.wfile.write(body)
            except OSError:
                pass
    server = HTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}/v1/systemone'
    finally:
        server.shutdown(); server.server_close(); thread.join()


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.batch = fixture(); self.limits = Limits(20000, 1.0, 100000)
        self.tokenizer = CharacterTokenizer()
        self.prepared = prepare(self.batch, self.tokenizer, self.limits, self.batch.binding)

    def check_both(self, value, *, status=200, expected_error=None):
        raw = json.dumps(value, allow_nan=True).encode()
        for adapter in ('dummy', 'http'):
            with self.subTest(adapter=adapter):
                if adapter == 'dummy':
                    client = DecisionClient(DummyTransport(raw, status, None), self.tokenizer, self.limits)
                    capture = client.invoke(self.batch, self.batch.binding)
                else:
                    with owned_http(raw, status, 0) as endpoint:
                        capture = DecisionClient(LoopbackTransport(endpoint, self.limits), self.tokenizer, self.limits).invoke(self.batch, self.batch.binding)
                self.assertEqual(capture.http.body, raw)
                if expected_error is not None:
                    with self.assertRaisesRegex(InvalidDecision, expected_error):
                        assess(capture, self.batch.binding)
                else:
                    assessment = assess(capture, self.batch.binding)
                    self.assertFalse(assessment.eligible)
                    self.assertEqual(assessment.answers[0].selected, 'claim')
                    self.assertEqual(assessment.answers[0].maximum_probability, .8)
                    self.assertEqual(assessment.answers[0].backend_confidence, .6)
                    self.assertEqual(assessment.input_tokens, self.prepared.untruncated_input_tokens)
                    self.assertEqual(assessment.output_tokens, 0)

    def test_shared_success_and_separate_confidence(self):
        self.check_both(response(self.prepared))

    def test_wrong_model(self):
        value=response(self.prepared); value['model']='wrong'; self.check_both(value, expected_error='response-identity')

    def test_missing_question(self):
        value=response(self.prepared); value['answers']={}; self.check_both(value, expected_error='response-identity')

    def test_extra_question(self):
        value=response(self.prepared); value['answers']['extra']={}; self.check_both(value, expected_error='response-identity')

    def test_bad_option(self):
        value=response(self.prepared); value['answers']['kind']['probabilities']={'claim':1.0,'other':0}; self.check_both(value, expected_error='answer-shape')

    def test_missing_usage_is_unavailable_not_zero(self):
        value=response(self.prepared); del value['usage']; self.check_both(value, expected_error='invalid-response')

    def test_null_usage_is_unavailable_not_zero(self):
        value=response(self.prepared); value['usage']=None; self.check_both(value, expected_error='input-completeness')

    def test_zero_input_does_not_establish_completeness(self):
        value=response(self.prepared); value['usage']['input_tokens']=0; self.check_both(value, expected_error='input-completeness')

    def test_bool_usage_is_not_integer(self):
        value=response(self.prepared); value['usage']['output_tokens']=False; self.check_both(value, expected_error='input-completeness')

    def test_input_token_mismatch(self):
        value=response(self.prepared); value['usage']['input_tokens']-=1; self.check_both(value, expected_error='input-completeness')

    def test_nonzero_generation_not_decision_path(self):
        value=response(self.prepared); value['usage']['output_tokens']=1; self.check_both(value, expected_error='input-completeness')

    def test_not_argmax(self):
        value=response(self.prepared); value['answers']['kind']['choice']='observation'; self.check_both(value, expected_error='choice-not-argmax')

    def test_no_renormalization(self):
        value=response(self.prepared); value['answers']['kind']['probabilities']['claim']=.7; self.check_both(value, expected_error='probability-mass')

    def test_invalid_probability_domain(self):
        for bad in (True, -.1, 1.1):
            value=response(self.prepared); value['answers']['kind']['probabilities']['claim']=bad; self.check_both(value, expected_error='probability-domain')

    def test_nonfinite(self):
        for bad in (float('nan'),float('inf')):
            value=response(self.prepared); value['answers']['kind']['probabilities']['claim']=bad; self.check_both(value, expected_error='nonfinite-json')

    def test_http_failure_preserves_body(self):
        self.check_both({'error':'synthetic overload'}, status=503, expected_error='transport-unavailable')

    def test_scope_before_network_and_after_capture(self):
        other=replace(self.batch.binding, scope='different')
        transport=DummyTransport(b'',200,None); client=DecisionClient(transport,self.tokenizer,self.limits)
        with self.assertRaisesRegex(InvalidDecision,'stale-binding'):client.invoke(self.batch,other)
        self.assertEqual(transport.sent,[])
        capture=Capture(self.prepared,HttpResult(200,json.dumps(response(self.prepared)).encode(),1,None))
        with self.assertRaisesRegex(InvalidDecision,'stale-binding'):assess(capture,other)

    def test_overflow_rejected_before_http_no_truncation(self):
        transport=DummyTransport(b'',200,None)
        limits=replace(self.limits,prompt_tokens=self.prepared.untruncated_input_tokens-1)
        with self.assertRaises(InputTooLarge):DecisionClient(transport,self.tokenizer,limits).invoke(self.batch,self.batch.binding)
        self.assertEqual(transport.sent,[])
        boundary=replace(self.limits,prompt_tokens=self.prepared.untruncated_input_tokens)
        self.assertEqual(prepare(self.batch,self.tokenizer,boundary,self.batch.binding).body,self.prepared.body)

    def test_source_digest_mismatch(self):
        with self.assertRaisesRegex(InvalidDecision,'source-binding'):prepare(replace(self.batch,evidence='changed'),self.tokenizer,self.limits,self.batch.binding)

    def test_duplicate_questions(self):
        with self.assertRaisesRegex(InvalidDecision,'question-identity'):prepare(replace(self.batch,questions=self.batch.questions*2),self.tokenizer,self.limits,self.batch.binding)

    def test_duplicate_options(self):
        q=replace(self.batch.questions[0],options=(Option('x','one'),Option('x','two')))
        with self.assertRaisesRegex(InvalidDecision,'option-shape'):prepare(replace(self.batch,questions=(q,)),self.tokenizer,self.limits,self.batch.binding)

    def test_numeric_loopback_only_no_credentials_or_query(self):
        for endpoint in ('http://localhost:30000/v1/systemone','http://192.0.2.1:30000/v1/systemone','https://127.0.0.1:30000/v1/systemone','http://u:p@127.0.0.1:30000/v1/systemone','http://127.0.0.1:30000/v1/systemone?x=1'):
            with self.assertRaises(InvalidDecision):LoopbackTransport(endpoint,self.limits)

    def test_order_preserved_and_options_sorted_for_tokenization(self):
        wire=json.loads(self.prepared.body); self.assertEqual(list(wire['questions']),['kind'])
        reversed_q=replace(self.batch.questions[0],options=tuple(reversed(self.batch.questions[0].options)))
        self.assertEqual(pieces(replace(self.batch,questions=(reversed_q,))),pieces(self.batch))

    def test_malformed_and_duplicate_json_preserved(self):
        for raw in (b'{',b'{"model":"x","model":"y"}'):
            capture=Capture(self.prepared,HttpResult(200,raw,1,None))
            with self.assertRaises(InvalidDecision):assess(capture,self.batch.binding)
            self.assertEqual(capture.http.body,raw)

    def test_response_bound_is_failure_not_json_salvage(self):
        limits=replace(self.limits,response_bytes=8)
        with owned_http(b'x'*100,200,0) as endpoint:
            capture=DecisionClient(LoopbackTransport(endpoint,limits),self.tokenizer,limits).invoke(self.batch,self.batch.binding)
        self.assertEqual(capture.http.error,'response-size-bound'); self.assertEqual(len(capture.http.body),8)
        with self.assertRaisesRegex(InvalidDecision,'transport-unavailable'):assess(capture,self.batch.binding)

    def test_deadline_is_total_not_per_byte_idle_timeout(self):
        limits=replace(self.limits,timeout_seconds=.05)
        with owned_http(b'x'*40,200,.01) as endpoint:
            capture=DecisionClient(LoopbackTransport(endpoint,limits),self.tokenizer,limits).invoke(self.batch,self.batch.binding)
        self.assertLess(capture.http.elapsed_ns,200_000_000)
        self.assertIsNotNone(capture.http.error)

if __name__=='__main__':unittest.main()
