const EXAMPLE_SESSION_ID = '00000000-0000-4000-8000-000000000001';
interface SearchArguments { readonly query: string; readonly mode: 'lexical'; readonly offset: number; readonly limit: number }
interface SessionArguments { readonly sessionId: string }
interface ContentArguments extends SessionArguments { readonly offset: number; readonly limit: number }
interface RelatedArguments extends SessionArguments { readonly limit: number }
interface PageArguments { readonly offset: number; readonly limit: number }
type EmptyArguments = Readonly<Record<string, never>>;
type ExampleParameters =
  | { readonly name: 'search_sessions'; readonly arguments: SearchArguments }
  | { readonly name: 'get_session'; readonly arguments: SessionArguments }
  | { readonly name: 'get_chunks' | 'get_messages'; readonly arguments: ContentArguments }
  | { readonly name: 'related_sessions'; readonly arguments: RelatedArguments }
  | { readonly name: 'list_facets' | 'whoami'; readonly arguments: EmptyArguments }
  | { readonly name: 'ingest_status'; readonly arguments: PageArguments };
export interface ToolRequestExample { readonly jsonrpc: '2.0'; readonly id: 1; readonly method: 'tools/call'; readonly params: ExampleParameters }
const EXAMPLES: readonly ExampleParameters[] = [
  { name: 'search_sessions', arguments: { query: 'synthetic', mode: 'lexical', offset: 0, limit: 20 } },
  { name: 'get_session', arguments: { sessionId: EXAMPLE_SESSION_ID } },
  { name: 'get_chunks', arguments: { sessionId: EXAMPLE_SESSION_ID, offset: 0, limit: 20 } },
  { name: 'get_messages', arguments: { sessionId: EXAMPLE_SESSION_ID, offset: 0, limit: 20 } },
  { name: 'related_sessions', arguments: { sessionId: EXAMPLE_SESSION_ID, limit: 5 } },
  { name: 'list_facets', arguments: {} },
  { name: 'ingest_status', arguments: { offset: 0, limit: 20 } },
  { name: 'whoami', arguments: {} },
];
export function toolRequestExample(name: string): ToolRequestExample | null {
  const params = EXAMPLES.find(example => example.name === name);
  return params === undefined ? null : { jsonrpc: '2.0', id: 1, method: 'tools/call', params };
}
