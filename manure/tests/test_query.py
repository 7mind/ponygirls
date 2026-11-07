"""Specified BA parser and BG MCP/client adapter behavior with controlled transport."""
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from manure import mcp
from manure import current_protocol as cp
from manure.client import ManureClient, ManureError
from test_current_client import CurrentTransport, ORIGIN, TOKEN


class QueryTests(unittest.TestCase):
    def test_mcp_exposes_query_only_search_schema(self):
        tools = {tool['name']: tool for tool in mcp._tool_defs()}
        self.assertIn('search', tools)
        schema = tools['search']['inputSchema']
        self.assertEqual(set(schema['properties']), {'query', 'limit', 'cursor'})
        self.assertEqual(schema['required'], ['query'])
        self.assertFalse(schema['additionalProperties'])
        self.assertTrue(tools['search']['annotations']['readOnlyHint'])
        self.assertTrue(tools['search']['annotations']['idempotentHint'])

    def test_shared_fixtures(self):
        from manure.query import parse_expression, QueryError
        fixtures = json.loads((Path(__file__).parent / 'fixtures/query-expressions.json').read_text())
        for case in fixtures:
            with self.subTest(name=case['name']):
                if 'error' in case:
                    with self.assertRaises(QueryError) as error:
                        parse_expression(case['query'])
                    self.assertEqual(error.exception.message, case['error'])
                    self.assertGreaterEqual(error.exception.start, 0)
                    self.assertGreaterEqual(error.exception.end, error.exception.start)
                else:
                    self.assertEqual(parse_expression(case['query']).as_dict(), case['expected'])

    def test_catalogue_expression_uses_typed_protocol(self):
        transport = CurrentTransport()
        client = ManureClient(ORIGIN, TOKEN, transport=transport)
        page = client.search_expression('access:public state:ready expired:true sort:name direction:asc text:"cat: dog"', limit=7, cursor='page')
        self.assertIn('artifacts', page)
        command = transport.commands[-1]
        self.assertEqual(command, cp.Command_ListArtifacts(cp.CatalogueQuery('cat: dog', True,
            cp.Visibility.Public, cp.ArtifactState.Ready, cp.CatalogueSort.Name, cp.SortDirection.Asc, 7, 'page')))

    def test_retrieval_expression_uses_typed_protocol(self):
        transport = CurrentTransport()
        client = ManureClient(ORIGIN, TOKEN, transport=transport)
        page = client.search_expression('mode:hybrid access:internal kind:dir owner:"Exact User" "cat  dog"', limit=8)
        self.assertEqual(page['count_scope'], 'exactmatches')
        self.assertEqual(transport.commands[-1], cp.Command_Search(cp.SearchQuery('"cat  dog"',
            cp.SearchMode.Hybrid, cp.SearchFilter(cp.Visibility.Internal, cp.ArtifactKind.Directory, 'Exact User'), 8, None)))

    def test_invalid_expression_and_retrieval_cursor_never_start_transport(self):
        transport = CurrentTransport()
        client = ManureClient(ORIGIN, TOKEN, transport=transport)
        for query, kwargs in [('unknown:private-secret', {}), ('mode:lexical cats', {'cursor': 'private-secret'}),
                              ('mode:lexical cats', {'cursor': ''})]:
            with self.subTest(query=query), self.assertRaises(ManureError) as error:
                client.search_expression(query, **kwargs)
            self.assertEqual(error.exception.code, 'bad-query')
            self.assertNotIn('private-secret', error.exception.message)
        self.assertEqual(transport.requests, [])

    def test_query_error_positions_are_utf16_and_sanitized(self):
        from manure.query import parse_expression, QueryError
        with self.assertRaises(QueryError) as error:
            parse_expression('🦄 unknown:private-secret')
        self.assertEqual((error.exception.start, error.exception.end), (3, 25))
        self.assertNotIn('private-secret', str(error.exception))

    def test_real_mcp_lifecycle_calls_controlled_client(self):
        transport = CurrentTransport()
        client = ManureClient(ORIGIN, TOKEN, transport=transport)
        messages = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': mcp.MCP_VERSION,
                'capabilities': {}, 'clientInfo': {'name': 'test', 'version': '1'}}},
            {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'search', 'arguments': {'query': 'access:public report', 'limit': 3}}},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'search', 'arguments': {'query': 'mode:semantic cats', 'limit': 4}}},
            {'jsonrpc': '2.0', 'id': 4, 'method': 'tools/call', 'params': {'name': 'search', 'arguments': {'query': 'unknown:private-secret'}}},
            {'jsonrpc': '2.0', 'id': 5, 'method': 'tools/call', 'params': {'name': 'search', 'arguments': {'query': '', 'mode': 'catalogue'}}},
            {'jsonrpc': '2.0', 'id': 6, 'method': 'tools/call', 'params': {'name': 'list_artifacts', 'arguments': {'include_expired': True}}},
            {'jsonrpc': '2.0', 'id': 7, 'method': 'tools/call', 'params': {'name': 'search', 'arguments': {'query': 'mode:lexical cats', 'cursor': 'cursor'}}},
        ]
        stdin = type('Input', (), {'buffer': io.BytesIO(''.join(json.dumps(m)+'\n' for m in messages).encode())})()
        stdout = io.StringIO()
        with patch.object(sys, 'stdin', stdin), patch.object(sys, 'stdout', stdout), patch.object(mcp, '_client_from_env', return_value=client):
            mcp.main()
        replies = {reply['id']: reply for reply in map(json.loads, stdout.getvalue().splitlines())}
        self.assertNotIn('isError', replies[2]['result'])
        self.assertNotIn('isError', replies[3]['result'])
        self.assertTrue(replies[4]['result']['isError'])
        self.assertEqual(json.loads(replies[4]['result']['content'][0]['text'])['code'], 'bad-query')
        self.assertNotIn('private-secret', stdout.getvalue())
        self.assertEqual(replies[5]['error']['code'], -32602)
        self.assertNotIn('isError', replies[6]['result'])
        self.assertTrue(replies[7]['result']['isError'])
        self.assertEqual(len(transport.commands), 3)
        self.assertIs(transport.commands[0].query.visibility, cp.Visibility.Public)
        self.assertEqual(transport.commands[0].query.limit, 3)
        self.assertIs(transport.commands[1].query.mode, cp.SearchMode.Semantic)
        self.assertTrue(transport.commands[2].query.includeExpired)


if __name__ == '__main__':
    unittest.main()
