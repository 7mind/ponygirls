// Deterministic synthetic coding-agent transcripts. Every text is invented for the capture harness;
// none is derived from a real session. ASCII except in the dedicated Unicode template.
import { api } from '../tests-browser/fixture.mjs';

const BASE_TIME = Date.parse('2026-11-10T08:00:00Z');

const USER = [
  'The nightly migration job failed again on staging. Can you find out why `V42__split_events.sql` hangs?',
  'Please add retry with exponential backoff to the uploader, but keep the existing public API.',
  'Why does `npm test` pass locally and fail in CI with a timeout in the websocket suite?',
  'Refactor the session-renewal hook so that it does not hold a reference to the connection after unmount.',
  'Can you summarise what changed between revision 3 and revision 4 of this transcript importer?',
  'Draft a design note for pagination of the activity tables. Keep it short; I need to review it in five minutes.',
  'The embedding provider returns 503 for about 2% of batches. Where should the retry live?',
  'Run the full backend test-suite and tell me which tests are slow. Do not change anything yet.',
  'Great, now apply the first fix only, and show me the diff before committing.',
  'Looks fine. Please also update the README section about running the collector under systemd.',
  'One more thing: the dark theme has poor contrast on the disabled buttons. Can you check the tokens?',
  'Thanks. Close this out with a summary I can paste into the ticket.',
];

const ASSISTANT = [
  'I looked at the migration and the lock graph. The statement `ALTER TABLE events ADD COLUMN ...` waits on a long-running `SELECT` held by the analytics role. The hang is therefore a **lock queue**, not a slow rewrite.\n\nProposed order of work:\n\n1. Set `lock_timeout = \'5s\'` for the migration session.\n2. Retry the statement up to three times.\n3. Move the backfill out of the migration into a background job.',
  'Here is the minimal change. The retry wrapper keeps the existing signature:\n\n```ts\nexport async function upload(chunk: Chunk, attempt = 0): Promise<Receipt> {\n  try {\n    return await client.put(chunk);\n  } catch (error) {\n    if (attempt >= MAX_ATTEMPTS || !isTransient(error)) throw error;\n    await sleep(Math.min(CAP_MS, BASE_MS * 2 ** attempt) * Math.random());\n    return upload(chunk, attempt + 1);\n  }\n}\n```\n\nFull jitter is used so concurrent collectors do not retry in lockstep.',
  'The websocket suite uses real timers and a 5s deadline. On CI the runner is shared, so the handshake sometimes takes longer than that. I would not raise the deadline; instead the test should wait for the `open` event rather than sleeping.',
  '## Findings\n\n- The hook registers a `focus` listener in `useEffect` but the cleanup closes over the *previous* connection.\n- `renewal.suspend()` is called after unmount in one path.\n\n### Fix\n\nStore the connection in a ref, and unsubscribe in the cleanup of the same effect that subscribed.',
  'Between r3 and r4 the importer changed in three ways: (a) message ids are now derived from the record index, (b) tool results are split into parts, (c) the title is taken from the first user message when none is recorded.',
  '> Pagination of the activity tables\n\nProposal: keep cursor-based loading, but show the loaded range ("1-50 of 380") and a visible "Load more" control instead of relying only on scroll position.',
  'Retry belongs in the provider client, not in the indexing worker: the worker already has a job-level retry with attempts, and nesting two retry layers multiplies delays. I suggest a bounded client-level retry for 429/503 only.',
  'The slowest tests are the PostgreSQL-backed suites (see the table below). Nothing was modified.\n\n| suite | seconds |\n|---|---|\n| ArchiveQueryTest | 212 |\n| IngestFlowTest | 187 |\n| ActivityPagingTest | 96 |',
  'Applied. The diff touches two files and adds one test. I have not committed anything.',
  'Updated the README. I also added a `Restart=on-failure` example and a note that the collector needs read access to the discovery roots.',
  'The disabled-state tokens `--disabled-ink` and `--disabled-surface` have a contrast ratio of 3.1:1 in dark mode; WCAG AA for text asks for 4.5:1. I recommend lightening the ink.',
  'Summary: the staging hang was a lock-queue wait caused by an analytics session; migration now uses `lock_timeout` with bounded retry. The uploader gained jittered retry. Tests added for both.',
];

const TOOL = [
  '$ psql -c "SELECT pid, state, wait_event_type, now() - query_start AS age, left(query, 60) FROM pg_stat_activity WHERE datname = \'chronicle\'"\n  pid  | state  | wait_event_type |   age    |                            left\n-------+--------+-----------------+----------+-------------------------------------------------------------\n 18344 | active | Lock            | 00:14:08 | ALTER TABLE events ADD COLUMN tenant_id uuid\n 17201 | idle in transaction | Client | 02:41:55 | SELECT count(*) FROM events WHERE created_at > now() - interval\n(2 rows)',
  '{"ok":true,"receipt":{"id":"7f1d4c9e-5f4c-4fd3-bc1a-0f26b9a8d7e1","revision":4,"bytes":18234,"stored":true},"warnings":[]}',
  'FAIL tests/transport.test.ts\n  ✕ reconnects with jitter (5003 ms)\n\n    Error: Timeout - Async callback was not invoked within the 5000 ms timeout.\n      at Timeout.<anonymous> (tests/transport.test.ts:88:11)\n      at listOnTimeout (node:internal/timers:581:17)\n\nTest Suites: 1 failed, 14 passed, 15 total\nTests:       1 failed, 211 passed, 212 total',
  'diff --git a/src/use-session-renewal.ts b/src/use-session-renewal.ts\n--- a/src/use-session-renewal.ts\n+++ b/src/use-session-renewal.ts\n@@ -12,9 +12,11 @@ export function useSessionRenewal(connection, stats, owner) {\n-  useEffect(() => { const off = connection.onFocus(renew); return off; }, []);\n+  const ref = useRef(connection); ref.current = connection;\n+  useEffect(() => { const off = ref.current.onFocus(renew); return off; }, [owner]);',
  'src/Archive.tsx:57:  const results = useInfiniteResource(...)\nsrc/Search.tsx:41:  const results = useResource(...)\nsrc/Activity.tsx:63:  const collectors = useInfiniteResource(...)\nsrc/Conversation.tsx:98:  const messages = useInfiniteResource(...)',
  'Error: connect ECONNREFUSED 127.0.0.1:5432\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1555:16) {\n  errno: -111,\n  code: \'ECONNREFUSED\',\n  syscall: \'connect\',\n  address: \'127.0.0.1\',\n  port: 5432\n}',
  'total 48\ndrwxr-xr-x  6 dev dev 4096 Nov 10 08:12 .\ndrwxr-xr-x 12 dev dev 4096 Nov  9 17:44 ..\n-rw-r--r--  1 dev dev 2210 Nov 10 08:12 README.md\n-rw-r--r--  1 dev dev 9871 Nov 10 07:58 collector.ts\ndrwxr-xr-x  2 dev dev 4096 Nov  8 11:03 tests',
  'ok  \tchronicle/uploader\t0.412s\nok  \tchronicle/discovery\t1.021s\nFAIL\tchronicle/retry\t0.094s\n--- FAIL: TestBackoffCap (0.00s)\n    retry_test.go:41: delay 3.2s exceeds cap 2s',
];

const FILLER = 'The quick synthetic transcript line keeps going so that wrapping and density can be judged. ';

function stamp(index) { return new Date(BASE_TIME + index * 47_000).toISOString(); }
function pick(list, index, seed) { return list[(index * 7 + seed * 3) % list.length]; }

function logBlock(lines, prefix) {
  return Array.from({ length: lines }, (_, i) => `${prefix} ${String(i + 1).padStart(5, '0')} 2026-11-10T08:${String(i % 60).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}Z INFO worker-${i % 8} processed window ${i} of ${lines} in ${(i * 13) % 900}ms`).join('\n');
}

/** Template catalogue: name, number of messages, passage count and special messages by position. */
export const TEMPLATES = [
  { name: 'medium', messages: 87, passages: 9, kind: 'mixed' },
  { name: 'short', messages: 14, passages: 3, kind: 'mixed' },
  { name: 'long', messages: 260, passages: 52, kind: 'heavy' },
  { name: 'markdown', messages: 45, passages: 12, kind: 'mixed' },
  { name: 'tiny', messages: 4, passages: 0, kind: 'mixed' },
  { name: 'unicode-wide', messages: 30, passages: 6, kind: 'wide' },
];

export function templateFor(revision) { return TEMPLATES[revision % TEMPLATES.length]; }

export function buildMessages(revision, searchTerm) {
  const template = templateFor(revision), seed = revision;
  const messages = [];
  for (let index = 0; index < template.messages; index++) {
    const role = index === 0 ? 'system' : index % 4 === 1 ? 'user' : index % 4 === 3 ? 'tool' : 'assistant';
    let text = role === 'system' ? 'You are a careful coding agent. Work in small, reviewable steps and report what you changed.'
      : role === 'user' ? pick(USER, index, seed) : role === 'tool' ? pick(TOOL, index, seed) : pick(ASSISTANT, index, seed);
    if (template.kind === 'heavy' && index === 31) text = logBlock(340, 'BACKFILL') + '\n' + FILLER.repeat(260);
    if (template.kind === 'heavy' && index === 59) text = logBlock(640, 'TRACE');
    if (template.kind === 'heavy' && index === 90 && role !== 'user') text = 'Long single paragraph. ' + FILLER.repeat(40);
    if (template.kind === 'wide' && index % 5 === 2) text = '日本語のテキストを含む合成メッセージです。🦄 URL: https://example.invalid/' + 'segment-'.repeat(40) + 'end ' + 'token='.concat('A1b2C3d4E5f6'.repeat(30));
    if (searchTerm !== undefined && index === Math.min(template.messages - 1, 9 + (seed % 5))) text = `Relevant note about ${searchTerm}: ${text}`;
    messages.push(new api.Message(`m${index + 1}`, index === 0 ? undefined : `m${index}`, role, text, stamp(index), index));
  }
  return messages;
}

const PROBLEMS = [
  ['Destructive command run without confirmation', ['tool-misuse', 'safety']],
  ['Flaky test retried instead of diagnosed', ['testing']],
  ['Claimed success before the build finished', ['verification']],
  ['Hallucinated an API that does not exist', ['hallucination']],
  ['Ignored explicit user constraint about public API', ['instruction-following']],
  ['Large refactor without an agreed plan', ['scope-creep']],
  ['Swallowed an exception and continued', ['error-handling']],
  ['Edited generated file by hand', ['tool-misuse', 'generated-code']],
  ['Repeated the same failing command four times', ['looping']],
  ['Misread a stack trace and fixed the wrong module', ['diagnosis']],
];

export function buildChunks(revision, generationId) {
  if (generationId === undefined) return [];
  const template = templateFor(revision), messages = buildMessages(revision, undefined), chunks = [];
  for (let k = 0; k < template.passages; k++) {
    const position = Math.max(1, Math.min(messages.length - 1, Math.floor((k + 1) * messages.length / (template.passages + 1))));
    const message = messages[position], first = Array.from(message.text).slice(0, 60).join(''), start = 0, end = Buffer.byteLength(first);
    const [summary, tags] = PROBLEMS[(k + revision) % PROBLEMS.length];
    chunks.push(new api.Chunk(`00000000-0000-4000-8000-${String(200000 + revision * 1000 + k).padStart(12, '0')}`, '00000000-0000-4000-8000-000000000001', message.text, `${summary} (#${k + 1})`, tags, [new api.Span(message.id, start, end)], 0.9 - k * 0.003));
  }
  return chunks;
}
