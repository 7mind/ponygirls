#!/usr/bin/env bash
# Heap sizing of indexing jobs (run C of docs/drafts/20261120-1201-append-only-ingest-spec.md §11.1, owner Q122): each
# synthetic Pi session, shaped like the owner's largest (556 MB raw in 73,715 lines), is uploaded through /api/ingest
# and indexed alone by the native server in `serve` (normal workers, stub models, budget disabled, large heap). Per
# session it prints messages, raw MB, M, F, pieces, windows, d, the claim estimate E (IndexingBudget.estimate), the live
# heap (-XX:+PrintGC) of the idle server before the ingest, at its peak during the ingest and during the job, its growth
# per window and per piece, WAL, disk and the /api/versions probe (every 100 ms, 1 s timeout). The server runs the
# complete-collection policy (-XX:InitialCollectionPolicy=OnlyCompletely, young generation 512 MiB per 768 dimensions):
# every collection then measures the live heap, which the policy does not change; pauses are those of complete
# collections, more frequent than under the production policy (Adaptive2). The idle live heap is taken by a collection
# that malformed 1 MiB ingest bodies provoke before the ingest and again after the job. On demand, from the repository
# root:
#
#   export TMPDIR="$(mktemp -d /tmp/heap.XXXXXX)"   # fixtures and the owned cluster; ~3 GB per 556 MB session
#   CHRONICLE_SERVER="$(nix build --no-link --print-out-paths .#chronicle.nativeArtifact)/libexec/chronicle-server" \
#   MEASURE_OUTPUT="$TMPDIR/results" \
#   nice -n 10 "$(nix build --no-link --print-out-paths .#service-test-fixture-tools)/bin/with-service-postgres" \
#     bash chronicle/scripts/measure-index-heap.sh 25:768 145:768 556:768 556:4000
#
# Arguments: one RAW_MB:DIMENSIONS per session (indexed one after another, each by a fresh server process and its own
# owner). The wrapper ends its workload after one hour: run the 556 MB sessions in invocations of their own. Optional:
# MEASURE_MAX_HEAP_BYTES (default 24 GiB), MEASURE_JOB_DEADLINE_SECONDS (default 3000), MEASURE_GC_POLICY (default
# OnlyCompletely; Adaptive2 measures only at its occasional complete collections), MEASURE_YOUNG_BYTES_PER_768.
# Limits raised for the test instance: maxBodyBytes 536,870,912 (its maximum), maxFileBytes 536,870,912, maxMessages
# 1,000,000, maxIndexingBudgetBytes 2^63-1 (disabled). A request above maxBodyBytes cannot travel through /api/ingest:
# such a session is sent with the messages derived from its full file and a raw file reduced to the same records without
# their content (the claim reads no raw file, so the job's heap is the same); the report names it.
# Every assertion (ingest accepted, job Complete with a publication, no OutOfMemoryError, no probe answer of 1 s or more
# or failure, E at least the job's measured heap) is evaluated after all measurements are printed; any failure exits 1.
set -euo pipefail
: "${CHRONICLE_SERVER:?set CHRONICLE_SERVER to the native server executable built from this tree}"
: "${MEASURE_OUTPUT:?set MEASURE_OUTPUT to a new directory for the results}"
: "${PONYGIRLS_OWNED_FIXTURE_ROOT:?run via the owned with-service-postgres wrapper}"
cd "$(dirname "$0")/../.."
exec python3 -c "$(cat <<'PY'
import hashlib, http.client, json, math, os, random, re, secrets, signal, socket, subprocess, sys, tempfile, time, uuid
from pathlib import Path

MIB = 1 << 20
SERVER = Path(os.environ['CHRONICLE_SERVER']).resolve(strict=True)
OUTPUT = Path(os.environ['MEASURE_OUTPUT'])
OWNED = Path(os.environ['PONYGIRLS_OWNED_FIXTURE_ROOT']).resolve(strict=True)
assert (OWNED / '.owned-test-only').read_text() == 'ponygirls-owned-test-v1\n'
DATABASE = json.loads(os.environ['PONYGIRLS_TEST_DATABASE_CHRONICLE'])
assert Path(DATABASE['passwordFile']).resolve(strict=True).is_relative_to(OWNED)
LOCATION = re.fullmatch(r'jdbc:postgresql://127\.0\.0\.1:(\d+)/(\w+)', DATABASE['jdbcUrl'])
assert LOCATION is not None, 'owned loopback database required'
MAX_HEAP_BYTES = int(os.environ.get('MEASURE_MAX_HEAP_BYTES', str(24 << 30)))
GC_POLICY = os.environ.get('MEASURE_GC_POLICY', 'OnlyCompletely')
# Young generation per 768 dimensions: a 768-dimension job is then measured about every 6 windows (556 MB session).
YOUNG_BYTES_PER_768 = int(os.environ.get('MEASURE_YOUNG_BYTES_PER_768', str(512 << 20)))
JOB_DEADLINE_SECONDS = int(os.environ.get('MEASURE_JOB_DEADLINE_SECONDS', '3000'))

# The owner's largest session (Q122): 556 MB raw in 73,715 lines. The rest from the clone (spec §0 V2, U4 rehearsal):
# its largest session holds 28,515 messages in 37,855 records and 82,761,182 message bytes in 145,760,829 raw bytes;
# head message texts have p99.9 77,243 B and a maximum of 596,865 B.
OWNER_RAW_BYTES = 556_000_000
OWNER_LINES = 73_715
MESSAGE_LINE_SHARE = 28_515 / 37_855
MESSAGE_BYTES_SHARE = 82_761_182 / 145_760_829
TEXT_P999_BYTES = 77_243
TEXT_MAX_BYTES = 596_865
# A stored message value besides its text (id, parentId, role, timestamp, recordIndex as JSON).
VALUE_OVERHEAD_BYTES = 170
BODY_BYTES = 536_870_912
BUDGET_DISABLED = 2**63 - 1
PROBE_PERIOD_SECONDS = 0.1
PROBE_TIMEOUT_SECONDS = 1.0
SAMPLE_PERIOD_SECONDS = 0.5
IDLE_SECONDS = 5
PUMP_BODY_BYTES = MIB
PUMP_REQUESTS = 4096
# IndexingBudget.estimate (Models.scala) with VectorArena.heldBytes: whole 2 MiB blocks of doubles.
MESSAGE_OBJECT_BYTES = 256
CHUNK_BYTES = 13_312
BLOCK_DOUBLES = 262_144
ARRAY_HEADER_BYTES = 16
failures = []


def check(label, condition, detail=''):
    print(('ok - ' if condition else 'FAILED - ') + label + ('' if condition else f': {detail}'), flush=True)
    if not condition:
        failures.append(f'{label}: {detail}')


def estimate(messages, message_bytes, fragments, dimensions):
    per_block = max(1, BLOCK_DOUBLES // dimensions)
    blocks = -(-fragments // per_block)
    return 2 * message_bytes + MESSAGE_OBJECT_BYTES * messages + CHUNK_BYTES * fragments + blocks * (per_block * dimensions * 8 + ARRAY_HEADER_BYTES)


def sql(query, *args):
    variables = [option for i, value in enumerate(args) for option in ('-v', f'arg{i}={value}')]
    result = subprocess.run(['psql', '-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', *variables, '-h', '127.0.0.1', '-p', LOCATION[1],
                             '-U', DATABASE['user'], '-d', LOCATION[2], '-f', '-'], input=query + ';\n', capture_output=True, text=True, timeout=60,
                            env=dict(os.environ, PGPASSWORD=Path(DATABASE['passwordFile']).read_text().strip()))
    assert result.returncode == 0, result.stderr
    return [line.split('|') for line in result.stdout.splitlines()]


def free_port():
    with socket.socket() as candidate:
        candidate.bind(('127.0.0.1', 0))
        return candidate.getsockname()[1]


def stop(process, timeout=30):
    if process is not None and process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)


# Loopback model stub (ch-fix2's semantics): one Problem part over each whole window, continuing the open one; embeddings
# from a fixed pool of 1,024 random vectors, each made distinct by a first component derived from its text.
STUB = r'''
import hashlib, json, random, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
port, dimensions = int(sys.argv[1]), int(sys.argv[2])
generator = random.Random(dimensions)
pool = []
for _ in range(1024):
    vector = [generator.gauss(0, 1) for _ in range(dimensions - 1)]
    norm = sum(x * x for x in vector) ** 0.5
    pool.append(','.join('%.6f' % (x / norm) for x in vector))
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def reply(self, body):
        data = body.encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/v1/chat/completions':
            source = json.loads(payload['messages'][1]['content'])
            content = json.dumps({'parts': [{'kind': 'Problem', 'start': {'fragmentIndex': 0, 'scalarOffset': 0}, 'end': {'fragmentIndex': len(source['fragments']), 'scalarOffset': 0},
                                             'continuePrevious': source.get('previous') is not None, 'summary': 'Synthetic annotation', 'tags': ['synthetic']}]})
            self.reply(json.dumps({'choices': [{'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': content}}]}))
        elif self.path == '/v1/embeddings':
            items = []
            for index, text in enumerate(payload['input']):
                digest = hashlib.sha256(text.encode()).digest()
                items.append('{"index":%d,"embedding":[%.9f,%s]}' % (index, 0.5 + int.from_bytes(digest[:4], 'big') / 2**33, pool[int.from_bytes(digest[4:6], 'big') % len(pool)]))
            self.reply('{"data":[' + ','.join(items) + ']}')
        else:
            self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers()
ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
'''

PROBE = r'''
import sys, time, urllib.request
url, out, period, timeout = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
with open(out, 'a', buffering=1) as f:
    while True:
        start = time.time()
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                response.read(); status = str(response.status)
        except Exception as error:
            status = type(error).__name__
        f.write(f'{start:.3f} {(time.time() - start) * 1000:.1f} {status}\n')
        time.sleep(max(0.0, period - (time.time() - start)))
'''

WORDS = ('the of and to in is that for it as with was on be at by this had not are but from or have an they which one you were all we '
         'there their will each about how up out them then many some so these other into has more two like time could no make than first '
         'been its who now made over did down only way find use may long little very after called just where most know get through back '
         'much before go good new write our used day same right look think also around another came come work three must because does '
         'part even place well such here take why help put different away again off went old number great tell say small every found '
         'still between name should home big give air line set own under read last never left end along while might next below saw '
         'something thought both few those always show large often together asked house world going want important until form keep '
         'index window fragment budget heap vector piece chunk session revision epoch claim publish worker lane probe collector server '
         'config value result error state query table column row commit test build check run file path module function return').split()
PAD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'


def corpus(generator, size):
    lines, total = [], 0
    while total < size:
        line = ' '.join(generator.choice(WORDS) for _ in range(generator.randint(4, 18)))
        lines.append(line); total += len(line) + 1
    return '\n'.join(lines)


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


class Fixture:
    """A synthetic Pi v3 session of the owner's shape: RAW_MB raw bytes in lines proportional to 73,715 per 556 MB, three
    quarters of them messages (user, assistant with thinking, text and a tool call, tool results) and the rest extension
    state records; message texts log-normal (p99.9 77,243 B, the largest one 596,865 B) scaled to the clone's message bytes per
    raw byte; user and assistant texts carry two non-Latin-1 characters (UTF-16 strings in the server), tool results are
    ASCII; the remaining raw bytes are opaque signature/detail/state fields. Messages are what the collector derives."""

    def __init__(self, directory, raw_mb, seed):
        self.directory = directory; self.raw_target = raw_mb * 1_000_000
        self.lines = max(8, round(OWNER_LINES * self.raw_target / OWNER_RAW_BYTES))
        generator = random.Random(seed)
        self.text = corpus(generator, 4 * MIB)
        self.pad = ''.join(generator.choice(PAD_ALPHABET) for _ in range(2 * MIB))
        self.session = str(uuid.UUID(int=generator.getrandbits(128), version=4))
        self.plan = self.planned(generator)

    def planned(self, generator):
        kinds, pending_turn = ['session'], 0
        for _ in range(1, self.lines):
            if generator.random() >= MESSAGE_LINE_SHARE:
                kinds.append('custom'); continue
            if pending_turn == 0:
                kinds.append('user'); pending_turn = 2 * generator.randint(1, 8) + 1
            else:
                kinds.append('assistant' if pending_turn % 2 == 1 else 'toolResult'); pending_turn -= 1
        messages = sum(kind not in ('session', 'custom') for kind in kinds)
        mean_text = self.raw_target * MESSAGE_BYTES_SHARE / max(1, messages) - VALUE_OVERHEAD_BYTES
        # log-normal with the clone's p99.9 and this mean: mu + 3.09 sigma = ln p99.9, mu + sigma^2/2 = ln mean
        a = math.log(TEXT_P999_BYTES) - math.log(mean_text)
        sigma = (3.0902 - math.sqrt(max(0.0, 3.0902 ** 2 - 2 * a))) if a > 0 else 0.5
        mu = math.log(mean_text) - sigma * sigma / 2
        sizes = [min(TEXT_MAX_BYTES, max(16, int(generator.lognormvariate(mu, sigma)))) if kind not in ('session', 'custom') else 0 for kind in kinds]
        scale = mean_text * messages / max(1, sum(sizes))
        sizes = [min(TEXT_MAX_BYTES, max(16, round(size * scale))) if size else 0 for size in sizes]
        sizes[sizes.index(max(sizes))] = TEXT_MAX_BYTES
        offsets = [generator.randrange(len(self.text) - TEXT_MAX_BYTES) for _ in kinds]
        return list(zip(kinds, sizes, offsets))

    def slice(self, offset, size, symbols):
        if symbols and size >= 16:
            return '→ ' + self.text[offset:offset + size - 8] + ' ≈'
        return self.text[offset:offset + size]

    def record(self, index, pad_bytes):
        kind, size, offset = self.plan[index]
        identifier = f'{index:08x}'; parent = self.session if index == 1 else f'{index - 1:08x}'
        millis = 1_767_225_600_000 + index * 1000
        stamp = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(millis // 1000)) + f'.{millis % 1000:03d}Z'
        start = offset % 4096
        pad = self.pad[start:start + pad_bytes] if start + pad_bytes <= len(self.pad) else (self.pad * (1 + pad_bytes // len(self.pad)))[:pad_bytes]
        if kind == 'session':
            return {'type': 'session', 'version': 3, 'id': self.session, 'timestamp': stamp, 'cwd': '/synthetic/heap-sizing'}, None
        if kind == 'custom':
            return {'type': 'custom', 'customType': 'synthetic-state', 'data': {'state': pad}, 'id': identifier, 'parentId': parent, 'timestamp': stamp}, None
        if kind == 'user':
            text = self.slice(offset, size, True)
            message = {'role': 'user', 'content': [{'type': 'text', 'text': text}], 'timestamp': millis}
        elif kind == 'assistant':
            command = {'command': self.text[offset:offset + 64].replace('\n', ' ')}
            call = 'toolCall bash ' + compact(command)
            thinking = self.slice(offset + 7, max(16, (size - len(call) - 2) // 4), True)
            answer = self.slice(offset + 13, max(16, size - len(call) - 2 - len(thinking.encode())), True)
            message = {'role': 'assistant', 'content': [{'type': 'thinking', 'thinking': thinking, 'thinkingSignature': pad}, {'type': 'text', 'text': answer},
                                                        {'type': 'toolCall', 'id': 'call_' + identifier, 'name': 'bash', 'arguments': command}],
                       'api': 'synthetic', 'provider': 'synthetic', 'model': 'synthetic-model', 'usage': {'input': 1, 'output': 1, 'cacheRead': 0, 'cacheWrite': 0, 'totalTokens': 2},
                       'stopReason': 'toolUse', 'timestamp': millis}
            text = '\n'.join([thinking, answer, call])
        else:
            text = self.slice(offset, size, False)
            message = {'role': 'toolResult', 'toolCallId': 'call_' + parent, 'toolName': 'bash', 'content': [{'type': 'text', 'text': text}], 'details': {'output': pad},
                       'isError': False, 'timestamp': millis}
        derived = {'id': identifier, 'parentId': parent, 'role': message['role'], 'text': text, 'timestamp': stamp, 'recordIndex': index}
        return {'type': 'message', 'id': identifier, 'parentId': parent, 'timestamp': stamp, 'message': message}, derived

    def build(self):
        """Writes the raw file, the reduced raw file and the request's parts; returns their sizes and digests."""
        base = [len(compact(self.record(index, 0)[0]).encode()) + 1 for index in range(self.lines)]
        padding = self.raw_target - sum(base)
        assert padding >= 0, f'the shape does not fit {self.raw_target} raw bytes'
        weights = [0 if kind in ('session', 'user') else 1.0 + size / 4096 if kind == 'assistant' else 0.5 + size / 4096 for kind, size, _ in self.plan]
        total = sum(weights)
        pads = [int(padding * weight / total) for weight in weights]
        pads[-1 if weights[-1] else next(i for i in range(self.lines - 1, -1, -1) if weights[i])] += padding - sum(pads)
        raw_digest, reduced_digest = hashlib.sha256(), hashlib.sha256()
        sizes = dict(raw=0, rawEncoded=0, reduced=0, reducedEncoded=0, messagesEncoded=0)
        derived_count = 0
        with open(self.directory / 'session.jsonl', 'wb') as raw, open(self.directory / 'raw.part', 'wb') as raw_part, \
                open(self.directory / 'reduced.part', 'wb') as reduced_part, open(self.directory / 'messages.part', 'wb') as messages_part:
            for index in range(self.lines):
                record, derived = self.record(index, pads[index])
                line = compact(record) + '\n'
                skeleton = compact({key: record[key] for key in ('type', 'id', 'parentId', 'timestamp') if key in record}) + '\n'
                for value, digest, file, key in ((line, raw_digest, raw, 'raw'), (skeleton, reduced_digest, None, 'reduced')):
                    data = value.encode(); digest.update(data); sizes[key] += len(data)
                    if file is not None:
                        file.write(data)
                    encoded = json.dumps(value, ensure_ascii=False)[1:-1].encode()
                    (raw_part if key == 'raw' else reduced_part).write(encoded); sizes[key + 'Encoded'] += len(encoded)
                if derived is not None:
                    encoded = ((',' if derived_count else '') + compact(derived)).encode()
                    messages_part.write(encoded); sizes['messagesEncoded'] += len(encoded); derived_count += 1
        return dict(lines=self.lines, messages=derived_count, rawDigest=raw_digest.hexdigest(), reducedDigest=reduced_digest.hexdigest(), **sizes)


def gc_events(log_path, started):
    """(wall time, kind, heap before MiB, heap after MiB, pause ms) of each collection in a -XX:+PrintGC log."""
    pattern = re.compile(r'^\[([\d.]+)s\] GC\(\d+\) Pause (\w+) GC \(.*?\) ([\d.]+)M->([\d.]+)M ([\d.]+)ms$', re.M)
    return [(started + float(t), kind, float(before), float(after), float(pause)) for t, kind, before, after, pause in pattern.findall(log_path.read_text(errors='replace'))]


def complete_collections(log_path):
    return log_path.read_text(errors='replace').count(' Pause Full GC ')


def pump(port, token, log_path):
    """Provokes a complete collection while the server is otherwise idle: malformed 1 MiB ingest bodies (400 once the body
    is read), one at a time, until the log shows a new complete collection; its live heap is the server's own plus at most
    one such body. Returns when the pump started, or None when no complete collection followed (another policy)."""
    seen, started = complete_collections(log_path), time.time()
    body = b'[' + b' ' * PUMP_BODY_BYTES + b'x'
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=60)
    try:
        for count in range(1, PUMP_REQUESTS + 1):
            connection.request('POST', '/api/ingest', body=body, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
            response = connection.getresponse(); response.read()
            assert response.status == 400, response.status
            if count % 8 == 0 and complete_collections(log_path) > seen:
                return started
        return None
    finally:
        connection.close()


def regression(points):
    """Least squares y = a + b x; None below three distinct x."""
    if len({x for x, _ in points}) < 3:
        return None
    n = len(points); mx = sum(x for x, _ in points) / n; my = sum(y for _, y in points) / n
    b = sum((x - mx) * (y - my) for x, y in points) / sum((x - mx) ** 2 for x, _ in points)
    return my - b * mx, b


def measure(spec, root):
    raw_mb, dimensions = (int(part) for part in spec.split(':'))
    label = f'{raw_mb}mb-d{dimensions}'
    out = OUTPUT / label; out.mkdir(parents=True)
    work = root / label; work.mkdir()
    print(f'== {label}: generating', flush=True)
    began = time.time()
    fixture = Fixture(work, raw_mb, seed=raw_mb)
    built = fixture.build()
    generated = time.time() - began
    owner = f'heap-{label}'
    request_id = str(uuid.uuid4())
    head = lambda digest: compact({'requestId': request_id, 'source': {'collectorNamespace': 'heap-sizing', 'discoveryRootId': 'synthetic', 'format': 'Pi',
                                                                      'producerSessionId': fixture.session, 'subagentId': None},
                                   'expectedRevision': 0, 'digest': digest, 'completion': 'Quiescent', 'redacted': False,
                                   'metadata': {'title': 'synthetic heap sizing session', 'project': '/synthetic/heap-sizing', 'workdir': '/synthetic/heap-sizing', 'gitRemote': None,
                                                'gitBranch': None, 'gitCommit': None, 'producer': 'Pi', 'model': 'synthetic-model', 'startedAt': '2026-01-01T00:00:00.000Z',
                                                'endedAt': None, 'tags': []}})[:-1] + ',"messages":['
    def body(digest, part):
        middle = '],"files":[{"path":"synthetic/heap-sizing/session.jsonl","sha256":"%s","content":"' % digest
        pieces = [head(digest).encode(), work / 'messages.part', middle.encode(), work / part, b'"}]}']
        return pieces, sum(p.stat().st_size if isinstance(p, Path) else len(p) for p in pieces)
    pieces, size = body(built['rawDigest'], 'raw.part')
    reduced = size > BODY_BYTES
    if reduced:
        pieces, size = body(built['reducedDigest'], 'reduced.part')
    print(f'   {built["lines"]} lines, {built["messages"]} messages, raw {built["raw"]} B, request {size} B ({"reduced raw" if reduced else "full raw"}), generated in {generated:.0f} s', flush=True)
    check(f'{label}: the request fits maxBodyBytes', size <= BODY_BYTES, size)

    port, stub_port = free_port(), free_port()
    origin = f'http://127.0.0.1:{port}'
    token = secrets.token_urlsafe(32)
    (work / 'token').write_text(token + '\n')
    (work / 'credential').write_text('')
    (work / 'password-hash').write_text(subprocess.run([str(SERVER), 'password-hash'], input='synthetic-heap-sizing\n', text=True, capture_output=True, check=True, timeout=60).stdout)
    config = json.loads(Path('chronicle/config.example.json').read_text())
    config.pop('accounts', None)
    config.update(listenPort=port, allowedOrigin=origin, secureCookies=False, allowInsecureHttp=False, jdbcUrl=DATABASE['jdbcUrl'], databaseUser=DATABASE['user'],
                  databasePasswordFile=DATABASE['passwordFile'], databaseLimits=DATABASE['limits'],
                  users=[dict(id=owner, login=owner, passwordHashFile=str(work / 'password-hash'), enabled=True)],
                  staticTokens=[dict(id=str(uuid.uuid4()), userId=owner, name='heap-sizing', scopes=['Ingest', 'Read'], tokenFile=str(work / 'token'))],
                  maxBodyBytes=BODY_BYTES, maxFileBytes=BODY_BYTES, maxMessages=1_000_000, maxIndexingBudgetBytes=BUDGET_DISABLED)
    config['annotation'].update(endpoint=f'http://127.0.0.1:{stub_port}/v1/chat/completions', credentialFile=str(work / 'credential'), timeoutSeconds=900, maxResponseBytes=MIB)
    config['embedding'].update(endpoint=f'http://127.0.0.1:{stub_port}/v1/embeddings', credentialFile=str(work / 'credential'), dimensions=dimensions, maxResponseBytes=8 * MIB)
    (work / 'server.json').write_text(json.dumps(config))
    stub = subprocess.Popen([sys.executable, '-c', STUB, str(stub_port), str(dimensions)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=(out / 'stub.log').open('w'), start_new_session=True)
    server = probe = None
    server_log = out / 'server.log'
    samples = []
    flags = ['-XX:+PrintGC', f'-XX:MaxHeapSize={MAX_HEAP_BYTES}', f'-XX:InitialCollectionPolicy={GC_POLICY}', f'-XX:MaxNewSize={YOUNG_BYTES_PER_768 * -(-dimensions // 768)}']
    wal_start = sql('SELECT pg_current_wal_lsn()')[0][0]
    session = claim = job_end = idle_pump = after_pump = peak_rss = None
    alive = False
    try:
        log = server_log.open('x')
        server_started = time.time()
        server = subprocess.Popen([str(SERVER), *flags, 'serve', str(work / 'server.json')], stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + 120
        while True:
            assert server.poll() is None, 'the server exited during start'
            try:
                connection = http.client.HTTPConnection('127.0.0.1', port, timeout=1); connection.request('GET', '/api/versions')
                if connection.getresponse().status == 200:
                    break
            except OSError:
                pass
            assert time.monotonic() < deadline, 'server readiness'
            time.sleep(0.1)
        probe = subprocess.Popen([sys.executable, '-c', PROBE, origin + '/api/versions', str(out / 'probe.txt'), str(PROBE_PERIOD_SECONDS), str(PROBE_TIMEOUT_SECONDS)],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        time.sleep(IDLE_SECONDS)
        idle_pump = pump(port, token, server_log)
        time.sleep(IDLE_SECONDS)
        print('   ingest', flush=True)
        ingest_start = time.time()
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=3600)
        connection.putrequest('POST', '/api/ingest')
        for name, value in (('Content-Type', 'application/json'), ('Authorization', 'Bearer ' + token), ('Content-Length', str(size))):
            connection.putheader(name, value)
        connection.endheaders()
        for piece in pieces:
            if isinstance(piece, Path):
                with piece.open('rb') as f:
                    while chunk := f.read(4 * MIB):
                        connection.send(chunk)
            else:
                connection.send(piece)
        response = connection.getresponse(); answer = response.read().decode()
        ingest_end = time.time()
        check(f'{label}: /api/ingest accepted the session', response.status == 200, f'{response.status} {answer[:500]}')
        session = json.loads(answer)['sessionId'] if response.status == 200 else None
        print(f'   ingest {ingest_end - ingest_start:.1f} s; indexing', flush=True)
        deadline = time.monotonic() + JOB_DEADLINE_SECONDS
        while session is not None and time.monotonic() < deadline and server.poll() is None:
            rows = sql("SELECT state,attempts,completed_windows,coalesce(total_windows,-1),coalesce(error,'') FROM ch_jobs WHERE session_id=:'arg0'", session)
            rss = int(re.search(r'VmRSS:\s+(\d+) kB', (Path('/proc') / str(server.pid) / 'status').read_text())[1]) * 1024
            samples.append((time.time(), rows[0][0], int(rows[0][1]), int(rows[0][2]), int(rows[0][3]), rows[0][4], rss))
            with (out / 'jobs.txt').open('a') as f:
                f.write(' '.join(str(v) for v in samples[-1]) + '\n')
            if claim is None and samples[-1][2] > 0:
                claim = samples[-1][0]
            if rows[0][0] in ('Complete', 'Failed'):
                job_end = time.time(); break
            time.sleep(SAMPLE_PERIOD_SECONDS)
        print(f'   job {samples[-1][1] if samples else "none"} after {(job_end or time.time()) - ingest_end:.0f} s', flush=True)
        if server.poll() is None:
            time.sleep(IDLE_SECONDS)
            after_pump = pump(port, token, server_log)
            time.sleep(1)
        alive = server.poll() is None
        if alive:
            peak_rss = int(re.search(r'VmHWM:\s+(\d+) kB', (Path('/proc') / str(server.pid) / 'status').read_text())[1]) * 1024
    finally:
        stop(probe); stop(server); stop(stub)
    wal_end = sql('SELECT pg_current_wal_lsn()')[0][0]

    check(f'{label}: the server ran until it was stopped', alive)
    check(f'{label}: no OutOfMemoryError', 'OutOfMemoryError' not in server_log.read_text(errors='replace'))
    job = sql("SELECT state,attempts,coalesce(error,''),coalesce(total_windows,0),completed_windows FROM ch_jobs WHERE session_id=:'arg0'", session)[0] if session else ['none', 0, '', 0, 0]
    check(f'{label}: the job is Complete', job[0] == 'Complete', job)
    counts = sql("SELECT message_count,message_bytes,fragment_count,raw_bytes,record_count,(epoch IS NOT NULL) FROM ch_revisions WHERE session_id=:'arg0' AND revision=1", session)[0] if session else [0, 0, 0, 0, 0, 'f']
    messages, message_bytes, fragments = (int(v) for v in counts[:3])
    published = int(sql("SELECT count(*) FROM ch_chunks c JOIN ch_generations g ON g.id=c.generation WHERE g.session_id=:'arg0'", session)[0][0]) if session else 0
    check(f'{label}: a publication with pieces', published > 0, published)
    check(f'{label}: the stored session is an epoch with the generated messages', counts[5] == 't' and messages == built['messages'], counts)
    wal = int(sql("SELECT pg_wal_lsn_diff(:'arg0',:'arg1')", wal_end, wal_start)[0][0].split('.')[0])
    database_bytes = int(sql('SELECT pg_database_size(current_database())')[0][0])
    cluster_bytes = int(subprocess.run(['du', '-sb', str(OWNED / 'cluster')], capture_output=True, text=True, check=True).stdout.split()[0])
    e = estimate(messages, message_bytes, fragments, dimensions)
    windows = int(job[3])

    # Live heap: the heap after each complete collection.
    events = gc_events(server_log, server_started)
    complete = [(t, after) for t, kind, before, after, pause in events if kind == 'Full']
    first_after = lambda moment: next((after for t, after in complete if t >= moment), None) if moment is not None else None
    baseline, after_job = first_after(idle_pump), first_after(after_pump)
    job_live = [(t, after) for t, after in complete if claim and claim - SAMPLE_PERIOD_SECONDS <= t <= (job_end or time.time())]
    ingest_live = [after for t, after in complete if ingest_start <= t <= ingest_end]
    peak_live_job = max((after for _, after in job_live), default=None)
    def windows_at(moment):
        return next((sample for sample in reversed(samples) if sample[0] <= moment), None)
    points = [(state[3], after) for t, after in job_live if (state := windows_at(t)) and state[1] == 'Running' and 0 <= state[3] < state[4]]
    fit = regression(points)
    pauses = sorted(pause for _, kind, _, _, pause in events if kind == 'Full')
    probe_lines = [line.split() for line in (out / 'probe.txt').read_text().splitlines()] if (out / 'probe.txt').exists() else []
    latencies = sorted(float(ms) for _, ms, status in probe_lines if status == '200')
    bad = [(float(t), float(ms), status) for t, ms, status in probe_lines if status != '200' or float(ms) >= 1000]
    percentile = lambda values, q: values[min(len(values) - 1, int(q * len(values)))] if values else None
    result = dict(
        session=label, rawMB=built['raw'] / 1e6, lines=built['lines'], messages=messages, recordCount=int(counts[4]), messageBytesM=message_bytes, fragmentsF=fragments,
        pieces=published, windows=windows, dimensions=dimensions, estimateE=e, estimateMessagesTerm=2 * message_bytes + MESSAGE_OBJECT_BYTES * messages,
        storedRawBytes=int(counts[3]), requestBytes=size, reducedRaw=reduced, ingestSeconds=round(ingest_end - ingest_start, 1),
        claimAfterIngestSeconds=round(claim - ingest_end, 1) if claim else None, jobSeconds=round(job_end - claim, 1) if claim and job_end else None,
        jobState=job[0], jobAttempts=int(job[1]), jobError=job[2],
        baselineMiB=baseline, afterJobMiB=after_job, peakLiveIngestMiB=max(ingest_live, default=None), peakLiveJobMiB=peak_live_job,
        liveVsWindows=dict(points=len(points), interceptMiB=round(fit[0], 1), perWindowMiB=round(fit[1], 4), perPieceBytes=round(fit[1] * MIB * windows / published) if published else None) if fit else None,
        peakHeapBeforeCollectionMiB=max((before for _, _, before, _, _ in events), default=None), peakRssBytes=peak_rss,
        collections=len(events), completeCollections=len(complete), completeCollectionsDuringJob=len(job_live),
        completePauseMs=dict(p50=percentile(pauses, .5), p90=percentile(pauses, .9), p99=percentile(pauses, .99), max=pauses[-1] if pauses else None),
        probe=dict(answers=len(latencies), failedOrSlow=len(bad), maxMs=latencies[-1] if latencies else None, p99Ms=percentile(latencies, .99), p999Ms=percentile(latencies, .999), worst=bad[:20]),
        walBytes=wal, databaseBytes=database_bytes, clusterBytes=cluster_bytes, generatedSeconds=round(generated, 1), serverFlags=flags)
    if peak_live_job is not None and baseline is not None:
        job_heap = (peak_live_job - baseline) * MIB
        result.update(jobHeapBytes=round(job_heap), jobHeapOverE=round(job_heap / e, 3))
        check(f'{label}: E ({e / 1e9:.3f} GB) is at least the job heap measured ({job_heap / 1e9:.3f} GB)', e >= job_heap)
    else:
        check(f'{label}: live heap before and during the job observed', False, dict(baseline=baseline, peak=peak_live_job))
    check(f'{label}: no /api/versions answer of 1 s or more and none failed ({len(latencies)} answers)', not bad, bad[:5])
    (out / 'measurement.json').write_text(json.dumps(result, indent=1))
    (out / 'gc.txt').write_text(''.join(f'{t:.3f} {kind} {before} {after} {pause}\n' for t, kind, before, after, pause in events))
    (out / 'live-vs-windows.txt').write_text(''.join(f'{x} {y}\n' for x, y in points))
    print(json.dumps(result), flush=True)
    for name in ('session.jsonl', 'raw.part', 'reduced.part', 'messages.part'):
        (work / name).unlink()
    return result


def main():
    os.umask(0o077)
    OUTPUT.mkdir(parents=True, exist_ok=False)
    specs = sys.argv[1:] or ['25:768', '145:768', '556:768', '556:4000']
    assert all(re.fullmatch(r'\d+:\d+', spec) for spec in specs), 'arguments: RAW_MB:DIMENSIONS ...'
    with tempfile.TemporaryDirectory(prefix='chronicle-heap-') as temporary:
        results = [measure(spec, Path(temporary)) for spec in specs]
    print('\nsession | messages | raw MB | M | F | pieces | windows | d | E GB | baseline MiB | peak live job MiB | job heap / E | per piece B | max pause ms | probe max ms')
    for r in results:
        print(' | '.join(str(v) for v in (r['session'], r['messages'], round(r['rawMB'], 1), r['messageBytesM'], r['fragmentsF'], r['pieces'], r['windows'], r['dimensions'],
                                          round(r['estimateE'] / 1e9, 3), r['baselineMiB'], r['peakLiveJobMiB'], r.get('jobHeapOverE'),
                                          (r['liveVsWindows'] or {}).get('perPieceBytes'), r['completePauseMs']['max'], r['probe']['maxMs'])))
    if failures:
        print(f'\n{len(failures)} assertion(s) failed:', *failures, sep='\n- ')
        sys.exit(1)
    print(json.dumps(dict(status='passed', sessions=len(results), server=str(SERVER))))


main()
PY
)" "$@"
