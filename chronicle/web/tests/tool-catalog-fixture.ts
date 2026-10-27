interface StringProperty { readonly type: 'string'; readonly maxLength: number }
interface IntegerProperty { readonly type: 'integer'; readonly minimum: number; readonly maximum: number }
interface ModeProperty { readonly type: 'string'; readonly enum: readonly string[] }
interface TagsProperty { readonly type: 'array'; readonly maxItems: number; readonly items: StringProperty }
export interface ToolInputProperties { readonly query?: StringProperty; readonly mode?: ModeProperty; readonly sessionId?: StringProperty; readonly offset?: IntegerProperty; readonly limit?: IntegerProperty; readonly revision?: IntegerProperty; readonly generationId?: StringProperty; readonly project?: StringProperty; readonly gitBranch?: StringProperty; readonly after?: StringProperty; readonly before?: StringProperty; readonly tags?: TagsProperty }
export interface ToolCatalogFixture { readonly name: string; readonly description: string; readonly inputSchema: { readonly type: 'object'; readonly properties: ToolInputProperties; readonly required: readonly (keyof ToolInputProperties)[]; readonly additionalProperties: false } }
const string: StringProperty = { type: 'string', maxLength: 2048 };
const integer = (minimum: number, maximum: number): IntegerProperty => ({ type: 'integer', minimum, maximum });
const paging = { offset: integer(0, 100000), limit: integer(1, 100) };
const contentPaging = { offset: integer(0, 2147483647), limit: integer(1, 100) };
const view = { revision: integer(1, 2147483647), generationId: string };
const filters: ToolInputProperties = { project: string, gitBranch: string, after: string, before: string, tags: { type: 'array', maxItems: 32, items: string } };
function tool(name: string, properties: ToolInputProperties, required: readonly (keyof ToolInputProperties)[]): ToolCatalogFixture {
  return { name, description: `Synthetic description for ${name}. Schema comes from the supplied catalog.`, inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}
export const toolCatalogFixture: readonly ToolCatalogFixture[] = [
  tool('search_sessions', { query: string, mode: { type: 'string', enum: ['lexical', 'semantic', 'hybrid'] }, ...paging, ...filters }, ['query', 'mode']),
  tool('get_session', { sessionId: string, ...view }, ['sessionId']),
  tool('get_chunks', { sessionId: string, ...contentPaging, ...view }, ['sessionId']),
  tool('get_messages', { sessionId: string, ...contentPaging, ...view }, ['sessionId']),
  tool('related_sessions', { sessionId: string, limit: integer(1, 100) }, ['sessionId']),
  tool('list_facets', filters, []),
  tool('ingest_status', paging, []),
  tool('whoami', {}, []),
];
