export interface CommandSpec {
  readonly path: string;
  readonly usage: string;
  readonly description: string;
  readonly options: readonly string[];
  readonly minimum: number;
  readonly maximum: number;
  readonly kind: 'operation' | 'direct' | 'group';
  readonly notes: string;
  readonly example: string;
}
const PAGE = ['offset', 'limit']; const CURSOR = ['cursor', 'limit']; const VIEW = ['revision', 'generation']; const FILTER = ['project', 'branch', 'after', 'before', 'tag'];
function command(path: string, arguments_: string, description: string, options: readonly string[], minimum: number, maximum: number, kind: CommandSpec['kind'], notes: string, example: string): CommandSpec {
  return { path, usage: `chronicle ${path}${arguments_ === '' ? '' : ` ${arguments_}`}`, description, options, minimum, maximum, kind, notes, example };
}
const SESSION = 'Human session only. Use chronicle login first.';
const JOBS = 'Human session by default; --auth bearer uses a token with the OperateJobs scope (with Read).';
const PIN = 'Copy revision and generationId from the cited ContentView; no silent HEAD repinning.';
const ID = '11111111-1111-4111-8111-111111111111';
const COMMANDS: readonly CommandSpec[] = [
  command('versions', '', 'Show the sole supported API version.', [], 1, 1, 'direct', 'Public: no credentials required.', 'chronicle versions'),
  command('login', '--login NAME (--password-file PATH | --password-stdin)', 'Create an independent private human session.', ['login', 'password-file', 'password-stdin'], 1, 1, 'direct', 'Exactly one protected password source; no password on argv.', 'chronicle login --login alice --password-file /private/password'),
  command('logout', '--yes', 'Revoke this independent human session.', [], 1, 1, 'direct', SESSION, 'chronicle logout --yes'),
  ...['settings', 'session-status'].map(path => command(path, '', 'Show the current human owner and account token metadata.', [], 1, 1, 'direct', SESSION, `chronicle ${path}`)),
  command('tokens', 'SUBCOMMAND', 'Manage independent account tokens.', [], 1, 1, 'group', 'Subcommands: list, mint, revoke. Run chronicle tokens SUBCOMMAND --help.', 'chronicle tokens list'),
  command('tokens list', '', 'List account token metadata, never secrets.', [], 2, 2, 'direct', SESSION, 'chronicle tokens list'),
  command('tokens mint', '--name NAME --scopes Read,Raw --secret-out NEW_PATH --yes', 'Issue a token, saving its one-time secret only to a new private file.', ['name', 'scopes'], 2, 2, 'direct', `${SESSION} Distinct Ingest,Read,Raw,OperateJobs scopes; Raw and OperateJobs require Read.`, 'chronicle tokens mint --name reader --scopes Read --secret-out /private/new-token --yes'),
  command('tokens revoke', 'TOKEN_UUID --yes', 'Revoke an issued account token.', [], 3, 3, 'direct', SESSION, `chronicle tokens revoke ${ID} --yes`),
  command('whoami', '', 'Show the identity of the selected credential.', [], 1, 1, 'operation', 'Auto uses a configured bearer token, otherwise the independent human session.', 'chronicle whoami'),
  command('search', "'TEXT'", 'Search indexed sessions; hybrid is the default mode.', ['mode', ...FILTER, ...PAGE], 2, 2, 'operation', 'Without --mode, hybrid is sent; if the embedding service fails, one lexical retry runs with a stderr notice. An explicit --mode is never substituted. Counts retain ExactMatches/CandidateWindow and ranking limits.', "chronicle search 'deployment failure' --limit 20 --json"),
  command('archive', "['EXPRESSION']", 'Search archived source evidence using the expression language.', [...CURSOR, 'sort', 'ascending', 'no-relevance'], 1, 2, 'operation', `${SESSION} Page limit 1..10 (default 10). Sorting defaults to LastTimestamp.`, "chronicle archive '' --limit 10"),
  command('session', 'UUID', 'Show full session metadata, source provenance and ContentView.', VIEW, 2, 2, 'operation', PIN, `chronicle session ${ID}`),
  ...['messages', 'chunks'].map(path => command(path, 'UUID', `Read a page of ${path} without truncating source text.`, [...VIEW, ...PAGE], 2, 2, 'operation', PIN, `chronicle ${path} ${ID} --revision 3 --offset 20`)),
  command('passages', 'UUID --revision N', 'Read a page of passages from an explicit content view.', [...VIEW, ...PAGE], 2, 2, 'operation', `${SESSION} ${PIN}`, `chronicle passages ${ID} --revision 3`),
  command('passage-spans', 'UUID PASSAGE_UUID --revision N', 'Read original source spans for an explicit passage.', [...VIEW, ...PAGE], 3, 3, 'operation', `${SESSION} ${PIN}`, `chronicle passage-spans ${ID} ${ID} --revision 3`),
  command('find', "UUID 'LITERAL' --revision N", 'Find literal source text within a pinned session.', [...VIEW, ...CURSOR], 3, 3, 'operation', `${SESSION} ${PIN}`, `chronicle find ${ID} 'failure' --revision 3`),
  command('locate', 'UUID MESSAGE_ID --revision N', 'Find a message position in a pinned session.', VIEW, 3, 3, 'operation', `${SESSION} ${PIN}`, `chronicle locate ${ID} message-id --revision 3`),
  command('context', 'UUID --revision N --message ID --start BYTE --end BYTE', 'Read source context around a half-open UTF-8 byte span.', [...VIEW, 'message', 'start', 'end', 'before-bytes', 'after-bytes'], 2, 2, 'operation', 'Offsets are UTF-8 bytes, not terminal columns or JavaScript characters.', `chronicle context ${ID} --revision 3 --message message-id --start 0 --end 12`),
  command('raw', 'UUID [--revision N] [--output PATH|- [--file I]]', 'Read archived JSONL as encoded data, or download one raw file byte-exact.', ['revision', 'file', 'output'], 2, 2, 'operation', `${SESSION} Without --output: GetRaw (JSON, up to the server's raw read bound; no --revision = archive head). --output: a new file (never replaced; mode 0600) or - for stdout; 64 MiB range requests, SHA-256 verified. --file I selects the file of a revision with several. --timeout-ms bounds each range request (writing included); a busy server (503) is retried after its Retry-After, at most 5 requests per range. On stdout a digest mismatch exits 6 after the bytes: check the exit status.`, `chronicle raw ${ID} --revision 3 --output ./session.jsonl`),
  command('related', 'UUID', 'Find related sessions.', ['limit'], 2, 2, 'operation', 'Auto uses a configured bearer token, otherwise the independent human session.', `chronicle related ${ID} --limit 20`),
  command('facets', '', 'Show facets for explicit search filters.', FILTER, 1, 1, 'operation', 'Repeat --tag for multiple tags.', 'chronicle facets --project example'),
  command('tags', "'QUERY'", 'Search the bearer tag catalog.', [...CURSOR, ...FILTER], 2, 2, 'direct', "Bearer only (auto selects bearer). --cursor is the exact last tag, including ''.", "chronicle tags '' --limit 100"),
  command('activity', "['EXPRESSION']", 'Read collector activity using the expression language.', [...CURSOR, 'sort', 'ascending'], 1, 2, 'operation', `${SESSION} Sorting defaults to CollectorId.`, "chronicle activity '' --limit 20"),
  command('jobs', "['EXPRESSION']", 'Read collection jobs using the expression language.', [...CURSOR, 'sort', 'ascending', 'scope', 'collector'], 1, 2, 'operation', `${JOBS} --scope Current|Historical|All. Mutation: jobs retry JOB_UUID --yes.`, "chronicle jobs '' --scope Current --limit 20"),
  command('jobs retry', 'JOB_UUID --yes', 'Deliberately retry the selected job.', [], 3, 3, 'operation', JOBS, `chronicle jobs retry ${ID} --yes`),
  ...['usage', 'collectors'].map(path => command(path, '', path === 'usage' ? 'Show model usage.' : 'Show collection status.', [], 1, 1, 'operation', SESSION, `chronicle ${path}`)),
  command('progress', '', 'Read a page of ingestion progress.', PAGE, 1, 1, 'operation', 'Auto uses a configured bearer token, otherwise the independent human session.', 'chronicle progress --offset 0 --limit 20'),
  ...['reindex', 'retry-failed'].flatMap(path => [
    command(path, 'SUBCOMMAND', 'Review an exact owner-wide selection before applying it.', [], 1, 1, 'group', `Subcommands: preview, apply${path === 'reindex' ? ', status' : ''}. ${path === 'reindex' ? 'All require a human session.' : JOBS}`, `chronicle ${path} preview`),
    command(`${path} preview`, '', 'Preview the exact target profile and selection hash.', [], 2, 2, 'operation', path === 'reindex' ? SESSION : `${JOBS} With --auth bearer the answer adds selection: jobs (to retry) and windowsToAnnotate (unknown: the server does not count them).`, `chronicle ${path} preview --json`),
    command(`${path} apply`, '--target-profile PROFILE --selection-hash HASH --yes', 'Apply a previously reviewed exact selection.', ['target-profile', 'selection-hash'], 2, 2, 'operation', `${path === 'reindex' ? SESSION : JOBS} No automatic preview/apply or mutation retry.`, `chronicle ${path} apply --target-profile PROFILE --selection-hash HASH --yes`),
  ]),
  command('reindex status', 'REQUEST_UUID', 'Inspect an existing reindex request.', [], 3, 3, 'operation', SESSION, `chronicle reindex status ${ID}`),
  command('receipt', 'REQUEST_UUID', 'Recover durable WS mutation metadata after uncertainty.', [], 2, 2, 'operation', `${SESSION} Token secrets are not recoverable; never blindly replay.`, `chronicle receipt ${ID} --json`),
  command('purge', 'SESSION_UUID --yes', 'Irreversibly purge the selected source.', [], 2, 2, 'operation', `${SESSION} Leaves a tombstone. No automatic retry.`, `chronicle purge ${ID} --yes`),
  command('groups', '[list]', 'List archive-sharing groups.', [], 1, 1, 'operation', 'Subcommands: list, create, invite, accept, remove, leave, delete. Changes require --yes.', 'chronicle groups list'),
  command('groups list', '', 'List archive-sharing groups.', [], 2, 2, 'operation', SESSION, 'chronicle groups list'),
  command('groups create', 'NAME --yes', 'Create an archive-sharing group.', [], 3, 3, 'operation', SESSION, "chronicle groups create 'project team' --yes"),
  command('groups invite', 'GROUP_UUID USER --yes', 'Invite a stable user ID into the selected group.', [], 4, 4, 'operation', SESSION, `chronicle groups invite ${ID} alice --yes`),
  command('groups accept', 'INVITE_UUID --confirm-sharing --yes', 'Accept an invitation and explicitly share your archive.', ['confirm-sharing'], 3, 3, 'operation', `${SESSION} Acceptance shares your archive with this group.`, `chronicle groups accept ${ID} --confirm-sharing --yes`),
  command('groups remove', 'GROUP_UUID USER --yes', 'Remove a user from an archive-sharing group.', [], 4, 4, 'operation', SESSION, `chronicle groups remove ${ID} alice --yes`),
  ...['leave', 'delete'].map(path => command(`groups ${path}`, 'GROUP_UUID --yes', path === 'leave' ? 'Leave an archive-sharing group.' : 'Delete an archive-sharing group.', [], 3, 3, 'operation', SESSION, `chronicle groups ${path} ${ID} --yes`)),
  ...['ingest', 'report-progress'].map(path => command(path, '--file PATH|- --yes', path === 'ingest' ? 'Submit an explicit generated IngestRequest document.' : 'Submit an explicit generated CollectorProgressUpdate document.', ['file'], 1, 1, 'direct', 'Bearer only (auto selects bearer). Never discovers or reads local session history.', `chronicle ${path} --file ./reviewed-request.json --yes`)),
  command('rpc', '--file PATH|-', 'Call one current typed application operation (call is an alias).', ['file'], 1, 1, 'direct', 'Use rpc help OPERATION for fields/effects. Mutations require --yes; MintToken needs --secret-out.', "printf '%s\\n' '{\"Whoami\":{}}' | chronicle rpc --file - --json"),
  command('rpc help', '[OPERATION]', 'Show the local typed operation catalog or exact schema.', [], 2, 3, 'direct', 'No credentials or service required. Hello/Ping/Pong are transport-owned.', 'chronicle rpc help ReadMessageContext'),
];
export function commandSpec(words: readonly string[]): CommandSpec | null {
  const first = words[0] === 'call' ? 'rpc' : words[0];
  const nested = COMMANDS.find(spec => spec.path === `${first} ${words[1]}`);
  if (nested !== undefined) return nested;
  return COMMANDS.find(spec => spec.path === first) ?? null;
}
export function usage(words: readonly string[]): string { const spec = commandSpec(words); return spec === null ? 'Usage: chronicle [global options] COMMAND [options]' : `Usage: ${spec.usage}`; }
export function help(words: readonly string[], exact: boolean): string {
  if (words.length === 0) return HELP;
  const spec = commandSpec(words); const target = words.map((word, index) => index === 0 && word === 'call' ? 'rpc' : word).join(' ');
  if (spec === null || (exact && spec.path !== target)) return '';
  const options = spec.options.length === 0 ? '' : `\nOptions: ${spec.options.map(key => `--${key}`).join(', ')}\n`;
  const nested = spec.kind === 'group' || spec.path === 'groups' ? `\n${COMMANDS.filter(child => child.path.startsWith(`${spec.path} `)).map(child => `  ${child.usage}`).join('\n')}\n` : '';
  const paging = spec.options.includes('offset') ? '\n--offset N >= 0; --limit 1..100 (default 20). Pages are explicit.\n' : '';
  const modes = spec.path === 'search' ? '\n--mode lexical|semantic|hybrid (default hybrid). Repeat --tag for filters.\n' : '';
  return `${usage(words)}\n${spec.description}\n${options}${nested}${paging}${modes}\n${spec.notes}\n\nExamples:\n  ${spec.example}\n\nGlobal: --url ORIGIN, --auth auto|session|bearer, --timeout-ms N,\n        --color auto|always|never, --json, --help. See chronicle --help.\n`;
}
export function helpHint(words: readonly string[]): string { const spec = commandSpec(words); return spec === null ? 'Run chronicle --help for commands.' : `Run chronicle ${spec.path} --help for options and examples.`; }

export const HELP = `chronicle — Chronicle application client (API 1.9.0)

Usage: chronicle [global options] COMMAND [options]
Readable output is the default, including pipes. --json before/after any command
emits one JSON document on stdout; diagnostics go only to stderr.

Authentication (independent credentials; no conversion or fallback):
  login --login NAME (--password-file PATH | --password-stdin)
  logout --yes                  Revoke this independent human session
  session-status | settings     Check cookie owner and account token metadata
  tokens list | mint --name NAME --scopes Read,Raw[,OperateJobs] --secret-out PATH --yes
  tokens revoke TOKEN_UUID --yes
  --auth auto                   Default: configured bearer for supported reads; else session
  --auth session | bearer       Explicit credential family; no fallback on failure
  CHRONICLE_TOKEN or CHRONICLE_TOKEN_FILE; both nonempty is an error

Discovery and retrieval:
  versions                      Public supported protocol versions
  whoami                        Identity of selected credential family
  search 'TEXT' [--mode lexical|semantic|hybrid] [--limit N --offset N]
  archive ['EXPRESSION'] [--cursor CURSOR --limit N --sort LastTimestamp]
  session UUID                  Metadata, full source identity and ContentView
  messages UUID | chunks UUID   [--revision N --generation UUID --offset N]
  passages UUID | passage-spans UUID PASSAGE_UUID   --revision N [--generation UUID]
  find UUID 'LITERAL' --revision N [--generation UUID --cursor CURSOR]
  locate UUID MESSAGE_ID --revision N [--generation UUID]
  context UUID --revision N --message ID --start BYTE --end BYTE
      [--generation UUID --before-bytes N --after-bytes N]
  raw UUID [--revision N]        Raw JSONL fidelity as encoded data; no implicit extraction
  raw UUID [--revision N] --output PATH|- [--file I]   Byte-exact download of any size
  related UUID | facets         Facets/search filters: --project --branch --after --before --tag
  tags 'QUERY' [--cursor TAG]   Bearer MCP tag catalog (auto selects bearer)

Activity and management (session only except progress and the job operations):
  activity ['EXPRESSION'] | jobs ['EXPRESSION'] [--cursor CURSOR --limit N]
  jobs retry JOB_UUID --yes
      jobs, jobs retry, retry-failed: also --auth bearer with an OperateJobs token
  usage | collectors | progress [--offset N --limit N]
  reindex preview | retry-failed preview
  reindex apply | retry-failed apply --target-profile P --selection-hash H --yes
  reindex status REQUEST_UUID
  groups [list] | create NAME | invite GROUP_UUID USER | accept INVITE_UUID --confirm-sharing
  groups remove GROUP_UUID USER | leave GROUP_UUID | delete GROUP_UUID
      All group changes require --yes; acceptance explicitly shares your archive.
  purge SESSION_UUID --yes       Irreversible; no automatic retries
  receipt REQUEST_UUID           Recover durable WS mutation metadata after uncertainty

Explicit ingestion (bearer Ingest scope; NEVER discovers local history):
  ingest --file PATH|- --yes     Current generated IngestRequest JSON; stable requestId
  report-progress --file PATH|- --yes    Current CollectorProgressUpdate JSON

Complete current API, including expression hints and MCP test runs:
  rpc help [OPERATION]           Local typed fields, enums and effect policy
  rpc --file PATH|-             One current generated Operation ADT, validated before I/O
      Mutations require --yes; MintToken also requires --secret-out (new private file).
      Hello/Ping/Pong are owned by the transport and cannot be called directly.

Global options:
  --url ORIGIN                  Or CHRONICLE_URL; exact HTTPS origin, no path/credentials/query
  --allow-insecure-http         Explicit trusted private-network HTTP opt-in (plaintext secrets!)
  --timeout-ms N                Whole command deadline, 100..900000 (default 30000);
                                raw --output: each request (manifest, every 64 MiB range)
  --request-id UUID             Deliberate WS or job-operation receipt identity; never auto replayed
  --secret-out PATH             New 0600 file in a private 0700 directory, never stdout
  --color auto|always|never     Auto: TTY human output only; honours NO_COLOR / TERM=dumb
  --json | --help               JSON is always plain; help is local, with no credentials
  help COMMAND [SUBCOMMAND]     Or COMMAND [SUBCOMMAND] --help: specific options/examples

Examples:
  chronicle --url https://archive.example login --login alice --password-file /private/password
  chronicle search 'deployment failure' --json
  chronicle messages 11111111-1111-4111-8111-111111111111 --revision 3 --offset 20
  chronicle --auth bearer tags 'postgres' --json
  chronicle rpc help StartMcpTest

Pages are explicit: pass returned nextCursor/offset; no hidden all-pages requests,
HEAD repinning, semantic fallback, credential redirects, reconnect or mutation retry.
Human text escapes terminal controls/bidi; --json preserves exact text as JSON strings.
i64 fields use generated decimal strings, never lossy JavaScript numbers.
State: CHRONICLE_STATE_DIR or \${XDG_STATE_HOME:-$HOME/.local/state}/chronicle-cli,
0700 directory / origin-bound 0600 files. No credentials on argv or URLs.
Exit: 0 success; 2 usage/invalid; 3 auth/credentials; 4 missing/gone/retired;
5 conflict; 6 transport/protocol/deadline/state/availability; 7 uncertain mutation.
`;
