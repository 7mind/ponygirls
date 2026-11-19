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

NOT_CONFIGURED = 'semantic retrieval is not configured; lexical-only capability'
EMBEDDING_FAILED = 'query embedding failed'
LEXICAL_ONLY_NOTICE = ('Hybrid search is not available on this server: semantic retrieval is not configured; '
                       'showing lexical results')
EMBEDDING_NOTICE = 'Hybrid search is not available on this server: query embedding failed; showing lexical results'


def sent(transport):
    return [type(c).__name__.removeprefix('Command_') + (':' + c.query.mode.value if isinstance(c, cp.Command_Search) else '')
            for c in transport.commands]


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

    def test_default_mode_fixtures(self):
        from manure.query import parse_expression, QueryError
        fixtures = json.loads((Path(__file__).parent / 'fixtures/query-defaults.json').read_text())
        for case in fixtures:
            with self.subTest(name=case['name']):
                continuation = case.get('continuation', False)
                if 'error' in case:
                    with self.assertRaises(QueryError) as error:
                        parse_expression(case['query'], continuation=continuation)
                    self.assertEqual(error.exception.message, case['error'])
                else:
                    plan = parse_expression(case['query'], continuation=continuation)
                    self.assertEqual((plan.as_dict(), plan.mode_explicit), (case['expected'], case['modeExplicit']))

    def test_default_mode_follows_capabilities_and_the_servers_fixed_reason(self):
        for name, modes, failures, requests, mode, notice in [
            ('hybrid offered', list(cp.SearchMode), {}, ['GetCapabilities', 'Search:Hybrid'], 'hybrid', None),
            ('lexical only', [cp.SearchMode.Lexical], {}, ['GetCapabilities', 'Search:Lexical'], 'lexical', LEXICAL_ONLY_NOTICE),
            ('embedding failed', list(cp.SearchMode), {cp.SearchMode.Hybrid: (cp.ErrorCode.SearchUnavailable, EMBEDDING_FAILED)},
             ['GetCapabilities', 'Search:Hybrid', 'Search:Lexical'], 'lexical', EMBEDDING_NOTICE),
            ('untrusted reason', list(cp.SearchMode), {cp.SearchMode.Hybrid: (cp.ErrorCode.SearchUnavailable, 'private-' + TOKEN)},
             ['GetCapabilities', 'Search:Hybrid', 'Search:Lexical'], 'lexical',
             'Hybrid search is not available on this server: search-unavailable; showing lexical results'),
        ]:
            with self.subTest(name):
                transport = CurrentTransport()
                transport.search_modes, transport.search_failures = modes, failures
                notices = []
                found = ManureClient(ORIGIN, TOKEN, transport=transport).search_expression(
                    'kind:dir tag:release "cat  dog"', limit=5, notify=notices.append)
                self.assertEqual(sent(transport), requests)
                self.assertEqual((found.mode, found.mode_explicit, found.notice), (mode, False, notice))
                self.assertEqual(notices, [notice] if notice else [])
                self.assertEqual(transport.commands[-1].query, cp.SearchQuery('"cat  dog"', cp.SearchMode(mode.capitalize()),
                    cp.SearchFilter(None, cp.ArtifactKind.Directory, None, ['release'], None, None), 5, None))

    def test_explicit_unavailable_mode_is_an_error_without_substitution(self):
        transport = CurrentTransport()
        transport.search_modes = [cp.SearchMode.Lexical]
        transport.search_failures = {cp.SearchMode.Semantic: (cp.ErrorCode.SearchUnavailable, NOT_CONFIGURED)}
        notices = []
        with self.assertRaises(ManureError) as error:
            ManureClient(ORIGIN, TOKEN, transport=transport).search_expression('mode:semantic report', notify=notices.append)
        self.assertEqual((error.exception.code, error.exception.message), ('search-unavailable', 'semantic retrieval is not configured'))
        self.assertEqual((sent(transport), notices), (['Search:Semantic'], []))

    def test_filters_catalogue_only_fields_and_cursor_keep_the_catalogue(self):
        for query, cursor in [('access:public tag:release', None), ('state:ready report', None), ('report', 'next')]:
            with self.subTest(query=query, cursor=cursor):
                transport = CurrentTransport()
                found = ManureClient(ORIGIN, TOKEN, transport=transport).search_expression(query, cursor=cursor)
                self.assertEqual((found.mode, found.notice, sent(transport)), ('catalogue', None, ['ListArtifacts']))
                self.assertEqual(transport.commands[0].query.cursor, cursor)

    def test_mcp_search_reports_effective_mode_notice_and_pending(self):
        transport = CurrentTransport()
        client = ManureClient(ORIGIN, TOKEN, transport=transport)
        transport.search_page = cp.SearchPage([], 0, cp.SearchCountScope.CandidateWindow, 1000, None, 2)
        with patch.object(mcp, '_client_from_env', return_value=client):
            pending = mcp.handle_tools_call('search', {'query': 'report'})
            transport.search_modes = [cp.SearchMode.Lexical]
            transport.search_page = cp.SearchPage([], 0, cp.SearchCountScope.ExactMatches, None, None, 0)
            lexical = mcp.handle_tools_call('search', {'query': 'report'})
            transport.search_modes = list(cp.SearchMode)
            transport.search_failures = {cp.SearchMode.Hybrid: (cp.ErrorCode.SearchUnavailable, EMBEDDING_FAILED),
                                         cp.SearchMode.Lexical: (cp.ErrorCode.Unavailable, 'private-' + TOKEN)}
            failed = mcp.handle_tools_call('search', {'query': 'report'})
        print('MCP search transcript:', json.dumps([pending, lexical, failed]))
        for result, mode, notice, note in [
                (pending, 'hybrid', None, '2 items are not yet indexed for semantic search; results may be incomplete'),
                (lexical, 'lexical', LEXICAL_ONLY_NOTICE, None)]:
            self.assertNotIn('isError', result)
            text = json.loads(result['content'][0]['text'])
            self.assertEqual(text, result['structuredContent'])
            self.assertEqual((text['mode'], text['notice'], text['pending_note']), (mode, notice, note))
            self.assertEqual(text['pending'], 2 if mode == 'hybrid' else 0)
        self.assertTrue(failed['isError'])
        self.assertEqual(json.loads(failed['content'][0]['text']),
                         {'code': 'unavailable', 'message': 'unavailable', 'notice': EMBEDDING_NOTICE})
        self.assertNotIn(TOKEN, json.dumps(failed))

    def test_catalogue_expression_uses_typed_protocol(self):
        transport = CurrentTransport()
        client = ManureClient(ORIGIN, TOKEN, transport=transport)
        found = client.search_expression('tag:Release tag:release hostname:HOST project:/work access:public state:ready expired:true sort:name direction:asc text:"cat: dog"', limit=7, cursor='page')
        self.assertIn('artifacts', found.page)
        command = transport.commands[-1]
        self.assertEqual(command, cp.Command_ListArtifacts(cp.CatalogueQuery('cat: dog', True,
            cp.Visibility.Public, cp.ArtifactState.Ready, cp.CatalogueSort.Name, cp.SortDirection.Asc, 7, 'page', ['Release', 'release'], 'HOST', '/work')))

    def test_retrieval_expression_uses_typed_protocol(self):
        transport = CurrentTransport()
        client = ManureClient(ORIGIN, TOKEN, transport=transport)
        found = client.search_expression('mode:hybrid tag:Release tag:release hostname:HOST project:/work access:internal kind:dir owner:"Exact User" "cat  dog"', limit=8)
        self.assertEqual(found.page['count_scope'], 'exactmatches')
        self.assertEqual(transport.commands[-1], cp.Command_Search(cp.SearchQuery('"cat  dog"',
            cp.SearchMode.Hybrid, cp.SearchFilter(cp.Visibility.Internal, cp.ArtifactKind.Directory, 'Exact User', ['Release', 'release'], 'HOST', '/work'), 8, None)))

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
        self.assertEqual(sent(transport), ['GetCapabilities', 'Search:Hybrid', 'Search:Semantic', 'ListArtifacts'])
        self.assertIs(transport.commands[1].query.filter.visibility, cp.Visibility.Public)
        self.assertEqual(transport.commands[1].query.limit, 3)
        self.assertTrue(transport.commands[3].query.includeExpired)


if __name__ == '__main__':
    unittest.main()
