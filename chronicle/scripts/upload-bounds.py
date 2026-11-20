#!/usr/bin/env python3
"""S2 acceptance runs A, B and D of docs/drafts/20261120-1201-append-only-ingest-spec.md §11.1; started by
test-upload-bounds.sh, whose header has the invocation. Synthetic Pi sessions only, generated here; the owned database
of the with-service-postgres wrapper only; every process it starts is stopped on exit."""
import base64, datetime, hashlib, http.client, json, os, random, re, resource, secrets, shlex, shutil, signal, socket, subprocess, sys, tempfile
import threading, time, urllib.error, urllib.parse, urllib.request, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

KiB, MiB, GiB = 1 << 10, 1 << 20, 1 << 30
SERVER = Path(os.environ['CHRONICLE_SERVER']).resolve(strict=True)
CLI = Path(os.environ['CHRONICLE_CLI']).resolve(strict=True)


def packaged(collector):
    """The node executable and entry point of a packaged chronicle-collector (its makeWrapper script)."""
    wrapper = Path(collector).resolve(strict=True)
    if wrapper.is_dir():
        wrapper = wrapper / 'bin/chronicle-collector'
    found = re.search(r'exec "(/nix/store/[^"]+/bin/node)"\s+(/nix/store/\S+/cli\.js)', wrapper.read_text())
    assert found is not None, f'not a packaged collector: {wrapper}'
    return found[1], found[2]


NODE, COLLECTOR = packaged(os.environ['CHRONICLE_COLLECTOR']) if os.environ.get('CHRONICLE_COLLECTOR') else (None, None)
OWNED = Path(os.environ['PONYGIRLS_OWNED_FIXTURE_ROOT']).resolve(strict=True)
assert (OWNED / '.owned-test-only').read_text() == 'ponygirls-owned-test-v1\n'
DATABASE = json.loads(os.environ['PONYGIRLS_TEST_DATABASE_CHRONICLE'])
assert Path(DATABASE['passwordFile']).resolve(strict=True).is_relative_to(OWNED)
LOCATION = re.fullmatch(r'jdbc:postgresql://127\.0\.0\.1:(\d+)/(\w+)', DATABASE['jdbcUrl'])
assert LOCATION is not None, 'owned loopback database required'
# Development only, not acceptance: shrinks the fixtures, the raw read bound, and keeps an indexing budget the small
# session fits.
SCALE = float(os.environ.get('UPLOAD_BOUNDS_SCALE', '1'))
EVIDENCE = Path(os.environ['UPLOAD_BOUNDS_EVIDENCE']) if os.environ.get('UPLOAD_BOUNDS_EVIDENCE') else None

# Production values (spec §4.4) and the heap they are sized for: the budget default is 2^31 - 1 of the 6.4 GiB bound.
PRODUCTION_HEAP = 6871947673
PRODUCTION_BUDGET = 2147483647
BODY_BYTES = 268435456
DEPLOYMENT_FILE_BYTES = 8 * GiB
DEPLOYMENT_MESSAGES = 2_000_000
RECORD_BYTES = 32 * MiB
PART_BYTES = 8 * MiB
DIMENSIONS = 768
COLLECTOR_HEAP_MB = 256
PROBE_PERIOD_MS, PROBE_TIMEOUT_S = 100, 1.0
PAGE = 100
MAX_PAGE_BYTES = 64 * MiB
JOB_WAIT_S = 1800
SMOKE_BUDGET = 96 * MiB

# Needles: letters the generated vocabulary never uses (j, k, q, w, x, y, z), so none occurs by chance.
COMMON = 'kobalt needle'
RARE = 'xyzzy quokka'
RARE_APPENDED = 'jinx wizzy'
NO_HIT = 'zyzzyva kumquat'
COMMON_EVERY, COMMON_AT = 101, 7

checks, phases, servers, collectors, deferred = [], [], [], [], []
running = []  # the server process of the current phase, for its CPU time


def check(label, condition, detail='', defer=False):
    """`defer`: a failure is reported now and fails the run at its end, after the remaining phases ran."""
    if not condition:
        if not defer:
            raise AssertionError(f'{label}: {str(detail)[:4000]}')
        deferred.append(f'{label}: {str(detail)[:4000]}')
        print('not ok -', label, str(detail)[:4000], flush=True)
        return
    checks.append(label)
    print('ok -', label, flush=True)


def note(message):
    print('#', message, flush=True)


def scaled_budget(heap_bytes):
    """The indexing budget of a heap bound, in the production proportion (2^31 - 1 of 6.4 GiB)."""
    budget = heap_bytes * PRODUCTION_BUDGET // PRODUCTION_HEAP
    return budget if SCALE == 1 else max(int(budget * SCALE), SMOKE_BUDGET)


def estimate(messages, message_bytes, fragments, dimensions=DIMENSIONS):
    """IndexingBudget.estimate (CONTRACT "Oversize guards")."""
    k = max(1, 262144 // dimensions)
    arena = -(-fragments // k) * (8 * dimensions * k + 16)
    return 2 * message_bytes + 256 * messages + 13312 * fragments + arena


# ---------------------------------------------------------------- database

def sql(query, *args, timeout=600):
    """Rows of a query as the service role; arguments are bound as psql variables :'arg0', :'arg1', ..."""
    variables = [option for i, value in enumerate(args) for option in ('-v', f'arg{i}={value}')]
    result = subprocess.run(['psql', '-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', *variables, '-h', '127.0.0.1', '-p', LOCATION[1],
                             '-U', DATABASE['user'], '-d', LOCATION[2], '-f', '-'], input=query + ';\n', capture_output=True, text=True, timeout=timeout,
                            env=dict(os.environ, PGPASSWORD=Path(DATABASE['passwordFile']).read_text().strip(), PGOPTIONS='-c statement_timeout=0'))
    assert result.returncode == 0, result.stderr
    return [line.split('|') for line in result.stdout.splitlines()]


def one(query, *args):
    rows = sql(query, *args)
    assert len(rows) == 1, rows
    return rows[0] if len(rows[0]) > 1 else rows[0][0]


def wal_lsn():
    return one('SELECT pg_current_wal_insert_lsn()')


def wal_since(lsn):
    return int(one("SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(), :'arg0')", lsn))


def du(path):
    # WAL segments recycled during the walk make du complain; its total stays meaningful.
    return int(subprocess.run(['du', '-sb', str(path)], capture_output=True, text=True).stdout.split()[0])


def disk():
    return dict(database=int(one('SELECT pg_database_size(current_database())')), cluster=du(OWNED / 'cluster'))


def server_cpu():
    """User and system CPU seconds of the running server process."""
    if not running or running[-1].poll() is not None:
        return 0.0
    fields = Path(f'/proc/{running[-1].pid}/stat').read_text().rsplit(')', 1)[1].split()
    return (int(fields[11]) + int(fields[12])) / os.sysconf('SC_CLK_TCK')


class Phase:
    """Wall time, WAL and disk of one step."""
    def __init__(self, name):
        self.name = name

    def __enter__(self):
        note(f'phase {self.name}')
        self.started, self.lsn, self.cpu = time.monotonic(), wal_lsn(), server_cpu()
        return self

    def __exit__(self, kind, value, trace):
        if kind is None:
            record = dict(name=self.name, wallSeconds=round(time.monotonic() - self.started, 1), walBytes=wal_since(self.lsn),
                          serverCpuSeconds=round(server_cpu() - self.cpu, 1), **disk())
            phases.append(record)
            note(json.dumps(record))


# ---------------------------------------------------------------- synthetic Pi transcripts

class Fixture:
    """One synthetic Pi session whose every message is a pure function of its index (overrides for the fillers that
    make a file exactly its target size and for large records), so reads can be compared exactly."""
    CONSONANTS, VOWELS = 'bcdfghlmnprstv', 'aeiou'
    POOL = None

    def __init__(self, path, session_id, large=None):
        self.path, self.session_id, self.large = path, session_id, dict(large or {})
        self.overrides, self.messages, self.bytes, self.digest = {}, 0, 0, hashlib.sha256()
        self.needles = {COMMON: [], RARE: [], RARE_APPENDED: []}
        if Fixture.POOL is None:
            rng = random.Random(20261120)
            words = set()
            while len(words) < 3000:
                words.add(''.join(rng.choice(self.CONSONANTS) + rng.choice(self.VOWELS) + (rng.choice(self.CONSONANTS) if rng.random() < 0.3 else '')
                                  for _ in range(rng.choice((1, 2, 2, 3, 3, 4)))))
            words = sorted(words)
            Fixture.POOL = []
            for _ in range(2048):
                sentences = [' '.join(rng.choice(words) for _ in range(rng.randint(5, 18))) for _ in range(rng.randint(3, 12))]
                Fixture.POOL.append(' '.join(s[0].upper() + s[1:] + '.' for s in sentences))

    @staticmethod
    def filled(start, size):
        """Text of exactly `size` ASCII bytes from the paragraph pool."""
        pieces, length, j = [], 0, start
        while length < size:
            piece = Fixture.POOL[j % len(Fixture.POOL)]
            pieces.append(piece)
            length += len(piece) + 1
            j += 7
        return ' '.join(pieces)[:size]

    def text(self, i):
        if i in self.overrides:
            return self.overrides[i]
        if i in self.large:
            return self.filled(i, self.large[i])
        count = 60 if i % 1000 == 999 else 3 + (i * 7) % 11
        parts = [f'Message {i}.'] + ([COMMON + '.'] if i % COMMON_EVERY == COMMON_AT else [])
        return ' '.join(parts + [self.POOL[(i * 131 + j * 977) % len(self.POOL)] for j in range(count)])

    def timestamp(self, i):
        return (datetime.datetime(2026, 1, 1, tzinfo=datetime.UTC) + datetime.timedelta(seconds=i)).strftime('%Y-%m-%dT%H:%M:%S.000Z')

    def message(self, i):
        """The message the collector derives from record i + 1 (record 0 is the session header)."""
        return dict(id=f'm{i:07d}', parentId=self.session_id if i == 0 else f'm{i - 1:07d}', role='user' if i % 2 == 0 else 'assistant',
                    text=self.text(i), timestamp=self.timestamp(i), recordIndex=i + 1)

    def line(self, i):
        m = self.message(i)
        record = dict(type='message', id=m['id'], parentId=m['parentId'], timestamp=m['timestamp'],
                      message=dict(role=m['role'], content=[dict(type='text', text=m['text'])]))
        return json.dumps(record, separators=(',', ':')) + '\n'

    def write(self, size, needle=None):
        """Appends records until the file grows by exactly `size` bytes; the last one is a filler carrying `needle`."""
        target = self.bytes + size
        with open(self.path, 'a', encoding='ascii', buffering=16 * MiB) as out:
            def emit(text):
                out.write(text)
                self.digest.update(text.encode('ascii'))
                self.bytes += len(text)
            if self.bytes == 0:
                emit(json.dumps(dict(type='session', version=3, id=self.session_id, timestamp=self.timestamp(0)), separators=(',', ':')) + '\n')
            reserve = 64 * KiB
            while True:
                i = self.messages
                line = self.line(i)
                if self.bytes + len(line) + reserve > target and i not in self.large:
                    break
                emit(line)
                self.messages += 1
                if i % COMMON_EVERY == COMMON_AT and i not in self.large:
                    self.needles[COMMON].append(i)
            i = self.messages
            self.overrides[i] = f'Message {i}.' + (f' {needle}.' if needle else '')
            room = target - self.bytes - len(self.line(i)) - 1
            assert room >= 0, (target, self.bytes)
            self.overrides[i] += ' ' + self.filled(i, room)
            emit(self.line(i))
            self.messages += 1
            if needle:
                self.needles[needle].append(i)
        assert self.bytes == target == self.path.stat().st_size, (self.bytes, target)
        return self

    def sha256(self):
        return self.digest.hexdigest()

    def summary(self):
        return dict(bytes=self.bytes, messages=self.messages, records=self.messages + 1, large=sorted(self.large.values()))


# ---------------------------------------------------------------- processes

PROBE = r'''
import sys, time, urllib.request
url, out, period, timeout = sys.argv[1], sys.argv[2], int(sys.argv[3]) / 1000, float(sys.argv[4])
with open(out, "a", buffering=1) as f:
    while True:
        t0 = time.time()
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r: r.read(); status = r.status
        except Exception as e: status = type(e).__name__
        f.write(f"{int(t0 * 1000)} {(time.time() - t0) * 1000:.1f} {status}\n")
        time.sleep(max(0, period - (time.time() - t0)))
'''

STUB = r'''
import hashlib, json, math, struct, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
dimensions, delay_file, port_file = int(sys.argv[1]), sys.argv[2], sys.argv[3]
counts = {"annotation": 0, "embedding": 0, "inputs": 0, "errors": 0}; lock = threading.Lock()
def delay():
    try: return float(open(delay_file).read().strip() or "0")
    except OSError: return 0.0
def vector(text):
    out, i = [], 0
    while len(out) < dimensions:
        out.extend(v / 2**31 - 1.0 for v in struct.unpack(">8I", hashlib.sha256(f"{i}:{text}".encode()).digest())); i += 1
    out = out[:dimensions]; n = math.sqrt(sum(v * v for v in out)); return [v / n for v in out]
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, value):
        body = json.dumps(value).encode(); self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path == "/counts":
            with lock: return self.reply(200, counts)
        self.reply(404, {})
    def do_POST(self):
        try:
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if self.path == "/v1/chat/completions":
                time.sleep(delay())
                source = json.loads(request["messages"][1]["content"]); n = len(source["fragments"]); assert n > 0
                content = json.dumps({"parts": [{"kind": "Problem", "start": {"fragmentIndex": 0, "scalarOffset": 0}, "end": {"fragmentIndex": n, "scalarOffset": 0},
                    "continuePrevious": source.get("previous") is not None, "summary": "Synthetic annotation", "tags": ["synthetic"]}]})
                with lock: counts["annotation"] += 1
                return self.reply(200, {"choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": "stop"}]})
            if self.path == "/v1/embeddings":
                data = [{"index": i, "embedding": vector(t)} for i, t in enumerate(request["input"])]
                with lock: counts["embedding"] += 1; counts["inputs"] += len(data)
                return self.reply(200, {"data": data})
            self.reply(404, {})
        except Exception:
            with lock: counts["errors"] += 1
            self.reply(500, {"error": "stub"})
server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
open(port_file, "w").write(str(server.server_address[1]))
server.serve_forever()
'''


def stop_group(process, grace=30):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)


def free_port():
    with socket.socket() as candidate:
        candidate.bind(('127.0.0.1', 0))
        return candidate.getsockname()[1]


def percentile(values, q):
    return values[min(len(values) - 1, int(q * len(values)))] if values else 0


class Probe:
    """GET /api/versions every 100 ms with a 1 s timeout while a server runs."""
    def __init__(self, root, label, origin):
        self.file = root / f'probe-{label}.txt'
        self.process = subprocess.Popen([sys.executable, '-c', PROBE, origin + '/api/versions', str(self.file), str(PROBE_PERIOD_MS), str(PROBE_TIMEOUT_S)],
                                        stdin=subprocess.DEVNULL, start_new_session=True)

    def stop(self):
        stop_group(self.process, 5)
        rows = [line.split() for line in self.file.read_text().splitlines()]
        answers = sorted(float(ms) for _, ms, status in rows if status == '200')
        failures = [(int(t), status) for t, _, status in rows if status != '200']
        return dict(probes=len(rows), failures=len(failures), firstFailures=failures[:5], maxMs=answers[-1] if answers else None,
                    p99Ms=percentile(answers, 0.99), p999Ms=percentile(answers, 0.999), over500Ms=sum(1 for ms in answers if ms > 500))


class Stub:
    def __init__(self, root):
        self.delay_file, port_file = root / 'stub-delay', root / 'stub-port'
        self.delay(0)
        self.process = subprocess.Popen([sys.executable, '-c', STUB, str(DIMENSIONS), str(self.delay_file), str(port_file)], stdin=subprocess.DEVNULL,
                                        start_new_session=True)
        deadline = time.monotonic() + 30
        while not port_file.exists() or not port_file.read_text():
            assert self.process.poll() is None and time.monotonic() < deadline, 'stub model server start'
            time.sleep(0.1)
        self.origin = f'http://127.0.0.1:{port_file.read_text()}'

    def delay(self, seconds):
        self.delay_file.write_text(str(seconds))

    def counts(self):
        with urllib.request.urlopen(self.origin + '/counts', timeout=5) as response:
            return json.loads(response.read())

    def stop(self):
        stop_group(self.process, 5)


GC = re.compile(r'^\[([\d.]+)s\] GC\(\d+\) Pause (\w+) GC \(.*?\) ([\d.]+)M->([\d.]+)M ([\d.]+)ms$', re.M)


class Server:
    """The native server in `serve` (normal indexing workers) with a bounded heap and -XX:+PrintGC, probed every 100 ms."""
    def __init__(self, root, label, binary, config, heap):
        self.root, self.label, self.binary, self.heap = root, label, binary, heap
        self.config = json.loads(Path(config).read_text())
        self.origin = self.config['allowedOrigin']
        self.log_path = root / f'server-{label}.log'
        log = self.log_path.open('x')
        self.started = time.monotonic()
        self.process = subprocess.Popen([str(binary), f'-XX:MaxHeapSize={heap}', '-XX:+PrintGC', 'serve', str(config)], stdin=subprocess.DEVNULL,
                                        stdout=log, stderr=subprocess.STDOUT, start_new_session=True, env=dict(os.environ, HOME=str(root / 'home')))
        log.close()
        deadline = time.monotonic() + 300
        while True:
            assert self.process.poll() is None, f'the {label} server exited during start: {self.log_path.read_text()[-3000:]}'
            try:
                with urllib.request.urlopen(self.origin + '/api/versions', timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                pass
            assert time.monotonic() < deadline, 'server readiness'
            time.sleep(0.2)
        note(f'{label} server ready after {time.monotonic() - self.started:.1f} s')
        running.append(self.process)
        self.probe = Probe(root, label, self.origin)

    def alive(self):
        return self.process.poll() is None

    def stop(self):
        probe = self.probe.stop()
        alive = self.alive()
        stop_group(self.process)
        log = self.log_path.read_text(errors='replace')
        gcs = [(kind, float(before), float(after), float(pause)) for _, kind, before, after, pause in GC.findall(log)]
        full = sorted(pause for kind, _, _, pause in gcs if kind == 'Full')
        summary = dict(label=self.label, binary=str(self.binary), heap=self.heap, wallSeconds=round(time.monotonic() - self.started, 1), aliveAtStop=alive,
                       outOfMemory=len(re.findall(r'OutOfMemoryError|Java heap space', log)),
                       peakLiveHeapMB=max((after for kind, _, after, _ in gcs if kind == 'Full'), default=None),
                       peakHeapAfterAnyCollectionMB=max((after for _, _, after, _ in gcs), default=None),
                       peakHeapBeforeCollectionMB=max((before for _, before, _, _ in gcs), default=None),
                       fullCollections=len(full), fullPauseMaxMs=full[-1] if full else None, fullPauseP99Ms=percentile(full, 0.99), probe=probe)
        servers.append(summary)
        note(json.dumps(summary))
        return summary


NODE_GC = re.compile(r'ms: (Scavenge|Mark-Compact|Mark-Sweep|Minor Mark-Sweep)[^\d]*?([\d.]+) \(([\d.]+)\) -> ([\d.]+) \(([\d.]+)\) MB')


class Proxy:
    """The collector's endpoint: forwards every request to the server and logs method, path (ids elided), status,
    milliseconds and body bytes, and the answer of every request that is not a part (progress reports, opens, commits)."""
    def __init__(self, root, target):
        target = urllib.parse.urlsplit(target)
        self.log = open(root / 'proxy.log', 'a', buffering=1)
        log = self.log

        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *args):
                pass

            def forward(self):
                started = time.time()
                length = int(self.headers.get('Content-Length') or 0)
                body = self.rfile.read(length) if length else None
                upstream = http.client.HTTPConnection(target.hostname, target.port, timeout=900)
                try:
                    upstream.request(self.command, self.path, body=body, headers={k: v for k, v in self.headers.items() if k.lower() not in ('host', 'connection', 'keep-alive')})
                    response = upstream.getresponse()
                    data = response.read()
                finally:
                    upstream.close()
                path = re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ':id', self.path)
                answer = '' if path.endswith('/parts') and response.status < 300 else data[:300].decode(errors='replace')
                log.write(f'{int(started * 1000)} {(time.time() - started) * 1000:.1f} {self.command} {path} {response.status} {length} {len(data)} {answer}\n')
                try:
                    self.send_response(response.status)
                    for name, value in response.getheaders():
                        if name.lower() not in ('transfer-encoding', 'connection', 'content-length'):
                            self.send_header(name, value)
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except OSError as error:
                    log.write(f'{int(time.time() * 1000)} client-gone {self.command} {path} {type(error).__name__}\n')
            do_GET = do_POST = forward

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.origin = f'http://127.0.0.1:{self.server.server_address[1]}'
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def lines(self):
        return Path(self.log.name).read_text().splitlines()

    def summary(self, since=0):
        lines = self.lines()[since:]
        rows = [line.split(' ', 7) for line in lines if ' client-gone ' not in line]
        parts = sorted(float(r[1]) for r in rows if r[3].endswith('/parts'))
        unanswered = sum(1 for line in lines if ' client-gone ' in line)
        failed = [dict(ms=float(r[1]), request=f'{r[2]} {r[3]}', status=int(r[4]), answer=r[7] if len(r) > 7 else '') for r in rows if int(r[4]) >= 300]
        reports = [r for r in rows if r[3] == '/api/collector/progress']
        return dict(requests=len(rows), parts=len(parts), partMsP50=percentile(parts, 0.5), partMsP99=percentile(parts, 0.99), partMsMax=parts[-1] if parts else None,
                    over15s=sum(1 for r in rows if float(r[1]) > 15000), clientGone=unanswered, failed=failed[:20], progressReports=len(reports),
                    progressNotAccepted=[r[7] for r in reports if len(r) > 7 and '"accepted":true' not in r[7]][:10])

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


class Collector:
    """The tree's collector, `--once`, under --max-old-space-size=256 with --trace-gc, through the logging proxy."""
    def __init__(self, root, origin, token_file, max_file_bytes, max_messages):
        self.root, self.home = root, root / 'home'
        self.config = root / 'collector.json'
        self.proxy = Proxy(root, origin)
        self.config.write_text(json.dumps(dict(enabled=True, endpoint=self.proxy.origin, tokenFile=str(token_file), stateDir=str(root / 'collector-state'),
                                               homeDir=str(self.home), discoverYolo=False, quietMs=0, uploadProtocol='parts',
                                               maxFileBytes=max_file_bytes, maxScanBytes=max_file_bytes, maxMessages=max_messages,
                                               maxRecordBytes=RECORD_BYTES)))
        self.env = {k: v for k, v in os.environ.items() if not k.startswith('CHRONICLE_') and k not in ('NODE_OPTIONS', 'NODE_PATH')}
        self.env.update(HOME=str(self.home))
        self.runs = 0

    def sessions(self, project):
        directory = self.home / '.pi/agent/sessions' / project
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def once(self, label):
        self.runs += 1
        out, err = self.root / f'collector-{self.runs}.out', self.root / f'collector-{self.runs}.err'
        started, before, mark = time.monotonic(), resource.getrusage(resource.RUSAGE_CHILDREN), len(self.proxy.lines())
        with out.open('x') as stdout, err.open('x') as stderr:
            code = subprocess.run([NODE, f'--max-old-space-size={COLLECTOR_HEAP_MB}', '--trace-gc', str(COLLECTOR), '--config', str(self.config), '--once'],
                                  env=self.env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, timeout=7200).returncode
        wall, after = time.monotonic() - started, resource.getrusage(resource.RUSAGE_CHILDREN)
        cpu = after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime
        text = out.read_text()
        results = [line[line.index('{"'):] for line in text.splitlines() if '{"' in line]
        gcs = [(kind, float(before), float(after)) for kind, before, _, after, _ in NODE_GC.findall(text)]
        summary = dict(label=label, exit=code, wallSeconds=round(wall, 1), cpuSeconds=round(cpu, 1), heapLimitMB=COLLECTOR_HEAP_MB,
                       peakLiveHeapMB=max((after for kind, _, after in gcs if kind == 'Mark-Compact'), default=None),
                       peakHeapBeforeCollectionMB=max((before for _, before, _ in gcs), default=None),
                       fullCollections=sum(1 for kind, _, _ in gcs if kind == 'Mark-Compact'),
                       outOfMemory='heap out of memory' in text + err.read_text(), requests=self.proxy.summary(mark))
        collectors.append(summary)
        note(json.dumps(summary))
        (self.root / f'collector-{self.runs}.result').write_text('\n'.join(line for line in text.splitlines() if not NODE_GC.search(line)) + '\n')
        if code != 0:
            status = self.status()
            note(f'{label}: collector result {results[-1] if results else None}')
            note(f'{label}: collector queue ' + json.dumps(status.get('queue'))[:4000])
            note(f'{label}: collector diagnostics ' + json.dumps(status.get('diagnostics'))[:4000])
        check(f'{label}: the collector prints its result, no out-of-memory, within {COLLECTOR_HEAP_MB} MB of heap',
              not summary['outOfMemory'] and results, (code, err.read_text()[-2000:], text[-2000:]))
        check(f'{label}: --once exits 0 (no upload failure, nothing left, no failed progress report)', code == 0,
              dict(exit=code, requests=summary['requests']), defer=True)
        return json.loads(results[-1])

    def status(self):
        result = subprocess.run([NODE, f'--max-old-space-size={COLLECTOR_HEAP_MB}', str(COLLECTOR), '--config', str(self.config), '--status', '--json'],
                                env=self.env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=120, check=True)
        return json.loads(result.stdout)


class Cli:
    def __init__(self, root, origin, password_file):
        self.origin, self.env = origin, dict({k: v for k, v in os.environ.items() if not k.startswith('CHRONICLE_')}, HOME=str(root / 'home'),
                                             CHRONICLE_STATE_DIR=str(root / 'cli-state'))
        self.call('login', '--login', 'alice', '--password-file', str(password_file), expect=0)

    def call(self, *args, expect=0):
        started = time.monotonic()
        result = subprocess.run([str(CLI), '--url', self.origin, '--allow-insecure-http', '--json', '--timeout-ms', '120000', *args], stdin=subprocess.DEVNULL,
                                env=self.env, capture_output=True, text=True, timeout=180)
        elapsed = time.monotonic() - started
        assert (result.returncode == 0) == (expect == 0), f'chronicle {args[0]}: exit {result.returncode}: {result.stderr[-2000:]} {result.stdout[-2000:]}'
        return (json.loads(result.stdout) if expect == 0 else result.stderr), elapsed

    def result(self, *args):
        value, elapsed = self.call(*args, '--auth', 'session')
        return next(iter(value.values()))['result'], elapsed


class Rpc:
    """The browser protocol over a minimal WebSocket client (cookie login, Hello, Ping/Pong): reads the CLI cannot make,
    whose result frames exceed the CLI's 8 MiB bound, and failure messages, which the CLI replaces by its own text."""
    def __init__(self, origin, password):
        self.origin = origin
        host, port = origin.removeprefix('http://').split(':')
        request = urllib.request.Request(origin + '/api/login', method='POST', data=json.dumps(dict(login='alice', password=password)).encode(),
                                         headers={'Content-Type': 'application/json', 'Origin': origin})
        with urllib.request.urlopen(request, timeout=30) as response:
            cookie = next(value.split(';')[0] for name, value in response.headers.items() if name.lower() == 'set-cookie' and value.startswith('chronicle_session='))
        self.socket = socket.create_connection((host, int(port)), timeout=600)
        key = base64.b64encode(os.urandom(16)).decode()
        self.socket.sendall((f'GET /api/ws HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n'
                             f'Sec-WebSocket-Version: 13\r\nOrigin: {origin}\r\nCookie: {cookie}\r\n\r\n').encode())
        head = b''
        while b'\r\n\r\n' not in head:
            head += self.socket.recv(1)
        assert head.startswith(b'HTTP/1.1 101'), head
        hello = self.call({'Hello': {'versions': ['1.9.0']}})
        assert 'Hello' in hello, hello

    def exact(self, n):
        data = bytearray()
        while len(data) < n:
            chunk = self.socket.recv(min(n - len(data), 1 << 20))
            assert chunk, 'socket closed'
            data += chunk
        return bytes(data)

    def frame(self, opcode, payload):
        mask = os.urandom(4)
        length = len(payload)
        header = bytes([0x80 | opcode]) + (bytes([0x80 | length]) if length < 126 else bytes([0x80 | 126]) + length.to_bytes(2, 'big') if length < 65536
                                            else bytes([0x80 | 127]) + length.to_bytes(8, 'big'))
        self.socket.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def receive(self):
        message = bytearray()
        while True:
            first, second = self.exact(2)
            length = second & 0x7f
            length = int.from_bytes(self.exact(2 if length == 126 else 8), 'big') if length >= 126 else length
            payload = self.exact(length)
            opcode = first & 0x0f
            if opcode == 9:
                self.frame(10, payload)
                continue
            assert opcode in (0, 1, 10), f'websocket opcode {opcode}: {payload[:200]!r}'
            if opcode == 10:
                continue
            message += payload
            if first & 0x80:
                return json.loads(message)

    def call(self, operation):
        request = str(uuid.uuid4())
        self.frame(1, json.dumps(dict(requestId=request, operation=operation)).encode())
        while True:
            envelope = self.receive()
            if 'Ping' in envelope['result']:
                self.frame(1, json.dumps(dict(requestId=envelope['requestId'], operation={'Pong': envelope['result']['Ping']})).encode())
            elif envelope['requestId'] == request:
                return envelope['result']

    def close(self):
        self.socket.close()


# ---------------------------------------------------------------- the server side of a run

class Harness:
    def __init__(self, root, run, heap, max_file_bytes):
        self.root, self.run, self.heap = root, run, heap
        self.heap_bytes = int(heap[:-1]) * (MiB if heap.endswith('m') else GiB)
        self.budget = scaled_budget(self.heap_bytes)
        self.max_file_bytes = max_file_bytes
        (root / 'home').mkdir()
        self.password = root / 'password'
        self.password.write_text('synthetic-upload-bounds\n')
        (root / 'password-hash').write_text(subprocess.run([str(SERVER), 'password-hash'], input='synthetic-upload-bounds\n', text=True,
                                                           capture_output=True, check=True, timeout=60).stdout)
        (root / 'empty-credential').write_text('')
        self.token_file = root / 'collector-token'
        self.token_file.write_text(secrets.token_urlsafe(32) + '\n')
        self.stub = Stub(root)
        port = free_port()
        self.origin = f'http://127.0.0.1:{port}'
        config = json.loads(Path('chronicle/config.example.json').read_text())
        config.update(listenPort=port, allowedOrigin=self.origin, secureCookies=False, allowInsecureHttp=False,
                      jdbcUrl=DATABASE['jdbcUrl'], databaseUser=DATABASE['user'], databasePasswordFile=DATABASE['passwordFile'], databaseLimits=DATABASE['limits'],
                      users=[dict(id='alice', login='alice', passwordHashFile=str(root / 'password-hash'), enabled=True)],
                      staticTokens=[dict(id=str(uuid.uuid4()), userId='alice', name='upload-bounds-collector', scopes=['Ingest'], tokenFile=str(self.token_file))],
                      maxBodyBytes=BODY_BYTES, maxFiles=16, maxFileBytes=max_file_bytes, maxMessages=DEPLOYMENT_MESSAGES, maxRecordBytes=RECORD_BYTES,
                      maxIndexingBudgetBytes=self.budget)
        if SCALE != 1:
            config['maxRawReadBytes'] = int(BODY_BYTES * SCALE)
        config['annotation'].update(endpoint=self.stub.origin + '/v1/chat/completions', credentialFile=str(root / 'empty-credential'), model='stub-annotation',
                                    revision='upload-bounds', requestPolicy='strict-json-schema', timeoutSeconds=900, maxResponseBytes=1048576)
        config['embedding'].update(endpoint=self.stub.origin + '/v1/embeddings', credentialFile=str(root / 'empty-credential'), model='stub-embedding',
                                   revision='upload-bounds', dimensions=DIMENSIONS, sendDimensions=False, timeoutSeconds=60, maxResponseBytes=4 * MiB)
        self.config = root / 'server.json'
        self.config.write_text(json.dumps(config))
        self.server = None
        self.collector = Collector(root, self.origin, self.token_file, max_file_bytes, DEPLOYMENT_MESSAGES)
        note(f'run {run}: server heap {heap}, indexing budget {self.budget}, maxFileBytes {max_file_bytes} (server and collector), '
             f'maxMessages {DEPLOYMENT_MESSAGES}, maxRecordBytes {RECORD_BYTES}, collector heap {COLLECTOR_HEAP_MB} MB')

    def start(self, label, binary=SERVER):
        self.server = Server(self.root, label, binary, self.config, self.heap)
        self.cli = None
        return self.server

    def stop(self):
        summary = self.server.stop()
        self.server = None
        label = summary['label']
        check(f'{label} server: no out-of-memory and still running when stopped', summary['outOfMemory'] == 0 and summary['aliveAtStop'], summary)
        probe = summary['probe']
        check(f'{label} server: every /api/versions probe answered within {PROBE_TIMEOUT_S:.0f} s ({probe["probes"]} probes, max {probe["maxMs"]} ms)',
              probe['probes'] > 0 and probe['failures'] == 0, probe)
        return summary

    def reader(self):
        if self.cli is None:
            self.cli = Cli(self.root, self.origin, self.password)
        return self.cli

    def api(self, method, path, body=None):
        token = self.token_file.read_text().strip()
        request = urllib.request.Request(self.origin + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                         headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    # --- state

    def source(self, fixture):
        rows = sql("SELECT s.id, s.revision FROM ch_sources s JOIN ch_revision_info i ON i.session_id=s.id AND i.revision=s.revision "
                   "WHERE s.owner='alice' AND i.source->>'producerSessionId'=:'arg0'", fixture.session_id)
        assert len(rows) == 1, rows
        return rows[0][0], int(rows[0][1])

    def head(self, session):
        row = one("SELECT r.revision, r.epoch, r.message_count, r.raw_bytes, r.record_count, r.message_bytes, r.fragment_count, r.envelope->>'digest' "
                  "FROM ch_sources s JOIN ch_revisions r ON r.session_id=s.id AND r.revision=s.revision WHERE s.id=:'arg0'", session)
        return dict(revision=int(row[0]), epoch=row[1], messages=int(row[2]), rawBytes=int(row[3]), records=int(row[4]), messageBytes=int(row[5]),
                    fragments=int(row[6]), digest=row[7])

    def upload(self, session, revision):
        row = one("SELECT u.id, u.append, u.parts, u.base_count, u.base_raw_bytes, u.raw_bytes, u.messages, "
                  "(SELECT count(*) FROM ch_upload_parts p WHERE p.upload=u.id AND p.raw_end - coalesce((SELECT q.raw_end FROM ch_upload_parts q WHERE q.upload=u.id AND q.ordinal=p.ordinal-1), 0) > :'arg2') "
                  "FROM ch_uploads u WHERE u.phase='Committed' AND (u.receipt->>'sessionId')::uuid=:'arg0' AND (u.receipt->>'revision')::int=:'arg1'",
                  session, revision, PART_BYTES)
        return dict(id=row[0], append=row[1] == 't', parts=int(row[2]), baseCount=int(row[3]), baseRawBytes=int(row[4]), rawBytes=int(row[5]),
                    messages=int(row[6]), largeParts=int(row[7]))

    def jobs(self, session):
        return [dict(revision=int(r[0]), state=r[1], error=r[2] or None, attempts=int(r[3]), completedWindows=int(r[4]), totalWindows=None if r[5] == '' else int(r[5]))
                for r in sql("SELECT revision, state, coalesce(error,''), attempts, completed_windows, coalesce(total_windows::text,'') FROM ch_jobs "
                             "WHERE session_id=:'arg0' ORDER BY revision", session)]

    def published(self, session):
        row = sql("SELECT g.revision FROM ch_sources s JOIN ch_generations g ON g.id=s.published WHERE s.id=:'arg0'", session)
        return int(row[0][0]) if row else None

    def wait(self, label, condition, timeout=JOB_WAIT_S, period=1.0):
        deadline = time.monotonic() + timeout
        while True:
            value = condition()
            if value:
                return value
            assert self.server is None or self.server.alive(), f'{label}: the server exited: {self.server.log_path.read_text(errors="replace")[-3000:]}'
            assert time.monotonic() < deadline, f'{label}: not reached within {timeout} s'
            time.sleep(period)

    # --- assertions shared by the runs

    def stored(self, label, fixture, revision, append, previous=None):
        session, head_revision = self.source(fixture)
        head = self.head(session)
        upload = self.upload(session, head['revision'])
        check(f'{label}: the upload committed revision {revision} whole: {fixture.messages:,} messages, {fixture.bytes:,} raw bytes exactly, the file\'s digest',
              head_revision == revision and head['messages'] == fixture.messages and head['rawBytes'] == fixture.bytes and head['records'] == fixture.messages + 1
              and head['digest'] == fixture.sha256(), (head, fixture.summary()))
        epoch_rows = int(one("SELECT count(*) FROM ch_epoch_messages WHERE epoch=:'arg0'", head['epoch']))
        if append:
            check(f'{label}: an append of {fixture.messages - previous["messages"]:,} messages after the head, in the head\'s epoch, '
                  f'{upload["parts"]} parts, {epoch_rows:,} epoch message rows',
                  upload['append'] and upload['baseCount'] == previous['messages'] and upload['baseRawBytes'] == previous['rawBytes']
                  and head['epoch'] == previous['epoch'] and upload['rawBytes'] == fixture.bytes - previous['rawBytes'] and epoch_rows == fixture.messages, (upload, head, previous))
        else:
            check(f'{label}: a replacement (no base) into a new epoch, {upload["parts"]} parts, {epoch_rows:,} epoch message rows',
                  not upload['append'] and upload['baseCount'] == 0 and upload['rawBytes'] == fixture.bytes and epoch_rows == fixture.messages
                  and (previous is None or head['epoch'] != previous['epoch']), (upload, head))
        head['estimate'] = estimate(head['messages'], head['messageBytes'], head['fragments'])
        head['upload'] = upload
        note(f'{label}: head {json.dumps(head)}')
        return session, head

    def uploaded(self, label, counters, uploaded, replacements):
        check(f'{label}: --once uploads {uploaded} revision(s) ({replacements} replacement(s)), no failure, nothing left queued',
              counters['uploaded'] == uploaded and counters['replacements'] == replacements
              and all(counters[k] == 0 for k in ('uploadFailures', 'quarantined', 'pending', 'stopped', 'conflicts', 'deferred')), counters)

    def budget_verdict(self, label, session, revision):
        job = self.wait(f'{label} job verdict', lambda: next((j for j in self.jobs(session) if j['revision'] == revision and j['state'] in ('Failed', 'Complete')), None))
        check(f'{label}: the job of revision {revision} ends Failed index-budget-exceeded before decoding, no attempt consumed',
              job['state'] == 'Failed' and job['error'] == 'index-budget-exceeded' and job['attempts'] == 0, job)
        return job

    def indexed(self, label, session, revision):
        self.wait(f'{label} publication', lambda: self.published(session) == revision)
        job = next(j for j in self.jobs(session) if j['revision'] == revision)
        check(f'{label}: the job of revision {revision} completes and its generation is published at the head ({job["completedWindows"]} windows)',
              job['state'] == 'Complete' and self.published(session) == revision == self.source_revision(session), job)
        return job

    def source_revision(self, session):
        return int(one("SELECT revision FROM ch_sources WHERE id=:'arg0'", session))

    def page(self, label, fixture, revision, page, elapsed, offset, client):
        n = fixture.messages
        got = page['messages']
        expected = [fixture.message(i) for i in range(offset, min(n, offset + PAGE))]
        sizes = [len(json.dumps(m, separators=(',', ':')).encode()) for m in expected]
        within = len(expected) if sum(sizes) <= MAX_PAGE_BYTES else next(i for i in range(len(sizes)) if sum(sizes[:i + 1]) > MAX_PAGE_BYTES)
        check(f'{label}: messages page at offset {offset:,} through {client} ({len(got)} messages, {sum(sizes[:len(got)]):,} B, {elapsed:.2f} s) equals the synthetic messages',
              got and got == expected[:len(got)] and len(got) >= min(within, len(expected)) and page['total'] == n and page['offset'] == offset
              and page['view']['revision'] == revision, dict(total=page['total'], offset=page['offset'], count=len(got), first=got[0]['id'] if got else None))

    def reads(self, label, fixture, session, revision, large_pages=()):
        """Pages, locate, context, Find and Archive search answer from stored rows; GetRaw refuses with the exact size.
        Pages holding a record above the CLI's 8 MiB frame bound are read over the browser protocol; the CLI's answer
        for them is recorded, not asserted."""
        cli = self.reader()
        rpc = Rpc(self.origin, self.password.read_text().strip())
        n = fixture.messages
        timings, observations = {}, {}
        regular = [offset for offset in (0, n // 2, n - PAGE) if not any(offset <= i < offset + PAGE for i in fixture.large)]
        for offset in regular:
            page, elapsed = cli.result('messages', session, '--revision', str(revision), '--offset', str(offset), '--limit', str(PAGE))
            self.page(label, fixture, revision, page, elapsed, offset, 'the CLI')
            timings[f'messages@{offset}'] = round(elapsed, 2)
        for offset in sorted({*large_pages, *(offset for offset in (0, n // 2, n - PAGE) if offset not in regular)}):
            started = time.monotonic()
            result = rpc.call({'GetMessages': dict(sessionId=session, offset=offset, limit=PAGE, view=dict(revision=revision, generationId=None))})
            elapsed = time.monotonic() - started
            check(f'{label}: the page at offset {offset:,} answers', 'Messages' in result, str(result)[:2000])
            self.page(label, fixture, revision, result['Messages']['result'], elapsed, offset, 'the browser protocol')
            timings[f'messages@{offset} (browser protocol)'] = round(elapsed, 2)
            attempt = subprocess.run([str(CLI), '--url', self.origin, '--allow-insecure-http', '--json', 'messages', session, '--revision', str(revision), '--offset', str(offset),
                                      '--limit', str(PAGE), '--auth', 'session'], env=cli.env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=300)
            observations[f'CLI messages@{offset}'] = dict(exit=attempt.returncode, stderr=attempt.stderr.strip()[:200])
            note(f'{label}: the CLI on the page at offset {offset:,}: exit {attempt.returncode} {attempt.stderr.strip()[:200]}')
        last = fixture.message(n - 1)
        located, elapsed = cli.result('locate', session, last['id'], '--revision', str(revision))
        check(f'{label}: LocateMessage of the last message answers position {n - 1:,} of {n:,} ({elapsed:.2f} s)',
              located['position'] == n - 1 and located['total'] == n, located)
        timings['locate'] = round(elapsed, 2)
        middle = fixture.message(n // 2)
        context, elapsed = cli.result('context', session, '--revision', str(revision), '--message', middle['id'], '--start', '0', '--end', '12')
        check(f'{label}: MessageContext around a middle message answers its text ({elapsed:.2f} s)',
              context['anchor'] == dict(messageId=middle['id'], messagePosition=n // 2, start=0, end=12)
              and any(middle['text'][:12] in excerpt['text'] for excerpt in context['excerpts']), context)
        timings['context'] = round(elapsed, 2)
        for name, literal, expected in (('common', COMMON, fixture.needles[COMMON]), ('rare', RARE, fixture.needles[RARE]),
                                        ('rare in the appended part', RARE_APPENDED, fixture.needles[RARE_APPENDED]), ('no-hit', NO_HIT, [])):
            found, elapsed = cli.result('find', session, literal, '--revision', str(revision))
            hits = [hit['position'] for hit in found['hits']]
            ids = [hit['messageId'] for hit in found['hits']]
            check(f'{label}: Find {name} {literal!r} answers {len(hits)} hit(s) in {elapsed:.2f} s, the first in position order',
                  hits == expected[:len(hits)] and ids == [fixture.message(i)['id'] for i in hits] and (len(hits) > 0) == (len(expected) > 0)
                  and (found['nextCursor'] is not None or len(hits) == len(expected)), dict(hits=hits[:10], expected=expected[:10], cursor=found['nextCursor']))
            timings[f'find {name}'] = round(elapsed, 2)
        for name, literal in (('rare', RARE), ('rare in the appended part', RARE_APPENDED)):
            if fixture.needles[literal]:
                result, elapsed = cli.result('archive', f'"{literal}" mode:lexical', '--limit', '10')
                sessions = [row['head']['id'] for row in result['page']['rows']]
                check(f'{label}: Archive lexical search for the {name} literal returns the session ({elapsed:.2f} s)', session in sessions, sessions)
                timings[f'archive {name}'] = round(elapsed, 2)
        failure, elapsed = self.reader().call('raw', session, '--revision', str(revision), '--auth', 'session', expect=1)
        check(f'{label}: the CLI\'s raw answers too-large ({elapsed:.2f} s)', 'too-large' in failure, failure)
        started = time.monotonic()
        result = rpc.call({'GetRaw': dict(sessionId=session, revision=revision)})
        elapsed = time.monotonic() - started
        check(f'{label}: GetRaw answers too-large naming the exact size {fixture.bytes:,} ({elapsed:.2f} s)',
              json.dumps(result).count('too-large') == 1 and f'raw revision of {fixture.bytes} bytes' in json.dumps(result), result)
        rpc.close()
        note(f'{label}: read timings {json.dumps(timings)}')
        return dict(timings=timings, observations=observations)


# ---------------------------------------------------------------- runs

def run_a(root):
    """1 GiB: replacement of 1,000,000,000 raw bytes, +5 % append, the 1 GiB boundary, a 16 MiB session that indexes;
    then the S2 -> S1 rollback (down-025, S1 binary with workers) and the same verdicts."""
    s1 = Path(os.environ['CHRONICLE_S1_SERVER']).resolve(strict=True)
    h = Harness(root, 'A', '768m', GiB)
    big = Fixture(h.collector.sessions('--u8-a--') / 'big.jsonl', 'u8-a-big')
    small = Fixture(h.collector.sessions('--u8-a-small--') / 'small.jsonl', 'u8-a-small')
    started = time.monotonic()
    big.write(int(1_000_000_000 * SCALE), RARE)
    note(f'fixture big {json.dumps(big.summary())} in {time.monotonic() - started:.1f} s')
    h.start('A-S2')
    with Phase('A1 replacement upload of the 1 GB session'):
        h.uploaded('A1', h.collector.once('A1 replacement'), 1, 1)
        session, first = h.stored('A1', big, 1, False)
    with Phase('A2 +5 % append'):
        big.write(int(50_000_000 * SCALE), RARE_APPENDED)
        h.uploaded('A2', h.collector.once('A2 append'), 1, 0)
        _, head = h.stored('A2', big, 2, True, first)
    with Phase('A3 open at the 1 GiB boundary'):
        identity = json.loads(one("SELECT source FROM ch_revision_info WHERE session_id=:'arg0' AND revision=2", session))
        identity['producerSessionId'] = 'u8-a-boundary'
        metadata = dict(title='upload bounds boundary', project=None, workdir=None, gitRemote=None, gitBranch=None, gitCommit=None, producer='upload-bounds',
                        model=None, startedAt=None, endedAt=None, tags=[])

        def declare(raw_bytes):
            return h.api('POST', '/api/ingest/uploads', dict(requestId=str(uuid.uuid4()), source=identity, expectedRevision=0, rawPath='boundary.jsonl', base=None,
                                                             digest=hashlib.sha256(b'').hexdigest(), rawBytes=str(raw_bytes), messageCount=0,
                                                             messageChain=hashlib.sha256(b'chronicle.message-chain.v1').hexdigest(), completion='Quiescent',
                                                             redacted=False, metadata=metadata))
        status, opened = declare(GiB)
        check('A3: an open declaring 1,073,741,824 raw bytes (= maxFileBytes) is accepted', status == 200 and opened['phase'] == 'Open', (status, opened))
        status, aborted = h.api('POST', f"/api/ingest/uploads/{opened['uploadId']}/abort")
        check('A3: that attempt aborts', status == 200 and aborted['phase'] == 'Aborted', (status, aborted))
        status, refused = declare(GiB + 1)
        check('A3: an open declaring 1,073,741,825 raw bytes is refused 413 too-large', status == 413 and refused['code'] == 'too-large', (status, refused))
    with Phase('A4 a 16 MiB session indexes and publishes on the same server'):
        small.write(int(16 * MiB * SCALE))
        h.uploaded('A4', h.collector.once('A4 16 MiB session'), 1, 1)
        small_session, small_head = h.stored('A4', small, 1, False)
        check(f'A4: the 16 MiB session\'s estimate {small_head["estimate"]:,} is within the budget {h.budget:,}', small_head['estimate'] <= h.budget, small_head)
        small_job = h.indexed('A4', small_session, 1)
    with Phase('A5 indexing verdict of the 1 GB session'):
        check(f'A5: the 1 GB head\'s estimate {head["estimate"]:,} exceeds the budget {h.budget:,}', head['estimate'] > h.budget, head)
        h.budget_verdict('A5', session, 2)
        first_job = next(j for j in h.jobs(session) if j['revision'] == 1)
        check('A5: the replacement\'s job ended index-budget-exceeded or was superseded by the append',
              first_job['state'] == 'Failed' and first_job['error'] in ('index-budget-exceeded', 'superseded-revision'), first_job)
    with Phase('A6 reads of the 1 GB session (S2)'):
        a6 = h.reads('A6', big, session, 2)
    s2 = h.stop()
    with Phase('A7 down-025 (S2 -> S1 rollback)'):
        env = dict(os.environ, PGPASSWORD=Path(DATABASE['passwordFile']).read_text().strip())
        base = ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', LOCATION[1], '-U', DATABASE['user'], '-d', LOCATION[2], '-f', 'chronicle/scripts/down-025-uploads.sql']
        preflight = subprocess.run(base, capture_output=True, text=True, env=env, timeout=600, check=True).stdout
        lines = dict(line.split('|', 1) for line in preflight.splitlines() if line.startswith('DOWN025.'))
        note('down-025 preflight: ' + json.dumps(lines))
        applied = subprocess.run(base[:5] + ['-v', 'mode=apply', '-v', 'apply_irreversible=yes', '-v', f'confirm_database={LOCATION[2]}', '-v', f"expect_plan={lines['DOWN025.plan']}"] + base[5:],
                                 capture_output=True, text=True, env=env, timeout=1800, check=True).stdout
        check('A7: down-025 applies (committed uploads kept as revisions, upload tables dropped)',
              applied.strip().splitlines()[-1] == 'DOWN025.result|applied' and lines['DOWN025.result'] == 'preflight-complete'
              and sql("SELECT to_regclass('public.ch_uploads') IS NULL") == [['t']], applied)
    h.start('A-S1', s1)
    with Phase('A8 S1 binary with workers: the same verdicts'):
        check('A8: the S1 binary serves the same heads', h.head(session)['revision'] == 2 and h.source_revision(small_session) == 1 and h.published(small_session) == 1)
        a8 = h.reads('A8', big, session, 2)
        job_id, fence = one("SELECT id, fence FROM ch_jobs WHERE session_id=:'arg0' AND revision=2", session)
        h.reader().call('jobs', 'retry', job_id, '--yes', '--auth', 'session')
        h.wait('A8 retried job claimed', lambda: one("SELECT state='Failed' AND fence>:'arg1'::bigint FROM ch_jobs WHERE id=:'arg0'", job_id, fence) == 't')
        h.budget_verdict('A8 (S1, retried)', session, 2)
    s1_summary = h.stop()
    h.stub.stop()
    return dict(fixture=big.summary(), small=small.summary(), heads=dict(first=first, appended=head, small=small_head), smallJob=small_job,
                jobs=h.jobs(session), budget=h.budget, reads=dict(S2=a6, S1=a8), servers=[s2, s1_summary])


def run_b(root):
    """≥ 4 GiB: 4,400,000,000 raw bytes with records of 9-20 MiB (large parts), appended to; other sessions index."""
    h = Harness(root, 'B', '1g', DEPLOYMENT_FILE_BYTES)
    sizes, total = [int(9.5 * MiB), 12 * MiB, int(16.5 * MiB), 20 * MiB], int(4_400_000_000 * SCALE)
    expected = (total - sum(sizes)) // 5200
    large = {int(expected * at): size for at, size in zip((0.04, 0.36, 0.66, 0.94), sizes)} if total > 2 * sum(sizes) else {expected // 2: sizes[0]}
    big = Fixture(h.collector.sessions('--u8-b--') / 'big.jsonl', 'u8-b-big', large)
    smalls = [Fixture(h.collector.sessions(f'--u8-b-small-{k}--') / 'small.jsonl', f'u8-b-small-{k}') for k in range(4)]
    started = time.monotonic()
    big.write(total, RARE)
    for fixture in smalls:
        fixture.write(int(3 * MiB * max(SCALE, 0.1)))
    note(f'fixture big {json.dumps(big.summary())} in {time.monotonic() - started:.1f} s')
    h.start('B-S2')
    with Phase('B1 replacement upload of the 4.4 GB session and four small sessions'):
        h.uploaded('B1', h.collector.once('B1 replacement'), 5, 5)
        session, first = h.stored('B1', big, 1, False)
        if SCALE == 1:
            check(f'B1: raw_bytes {first["rawBytes"]:,} > 2^32 stored exactly', first['rawBytes'] == 4_400_000_000 > 2 ** 32, first)
        check(f'B1: {first["upload"]["largeParts"]} parts carried one large record each (≥ {len(large)})',
              first['upload']['largeParts'] >= len(large), first['upload'])
        status, state = h.api('GET', f"/api/ingest/uploads/{first['upload']['id']}")
        check('B1: the committed attempt reports receivedRawBytes exactly (i64)', status == 200 and state['phase'] == 'Committed'
              and int(state['receivedRawBytes']) == big.bytes and state['receivedMessages'] == big.messages, state)
    with Phase('B2 append (+44,000,000 bytes with one 10 MiB record)'):
        big.large[big.messages + 100] = 10 * MiB
        big.write(max(int(44_000_000 * SCALE), 24 * MiB), RARE_APPENDED)
        h.uploaded('B2', h.collector.once('B2 append'), 1, 0)
        _, head = h.stored('B2', big, 2, True, first)
        check('B2: the append carried its large record in a large part', head['upload']['largeParts'] >= 1, head['upload'])
        status, state = h.api('GET', f"/api/ingest/uploads/{head['upload']['id']}")
        check('B2: the append attempt reports its received bytes exactly', status == 200 and int(state['receivedRawBytes']) == big.bytes - first['rawBytes'], state)
    with Phase('B3 indexing: the 4.4 GB session fails the budget, the other sessions index'):
        check(f'B3: the head\'s estimate {head["estimate"]:,} exceeds the budget {h.budget:,}', head['estimate'] > h.budget, head)
        h.budget_verdict('B3', session, 2)
        small_jobs = [h.indexed(f'B3 small session {k}', h.source(fixture)[0], 1) for k, fixture in enumerate(smalls)]
    with Phase('B4 reads of the 4.4 GB session'):
        b4 = h.reads('B4', big, session, 2, large_pages=[min(big.large) - PAGE // 2, max(i for i in big.large if i < first['messages']) - 10, max(big.large) - 1])
    s2 = h.stop()
    h.stub.stop()
    return dict(fixture=big.summary(), heads=dict(first=first, appended=head), jobs=h.jobs(session), smallJobs=small_jobs, budget=h.budget, reads=b4, servers=[s2])


def run_d(root):
    """Growth while indexing: a 2 MB session grows by appends over 6 more revisions while its jobs run; it ends indexed at
    its head. Appends come in groups, each while a job of the then head revision runs (S0-I1: the running job continues,
    the head job waits; a queued job is superseded by the next append)."""
    h = Harness(root, 'D', '768m', DEPLOYMENT_FILE_BYTES)
    grow = Fixture(h.collector.sessions('--u8-d--') / 'grow.jsonl', 'u8-d-grow')
    delay = float(os.environ.get('UPLOAD_BOUNDS_D_DELAY', '1.0'))
    h.stub.delay(delay)
    note(f'stub annotation delay {delay} s per window')
    h.start('D-S2')
    groups, growth = [2, 1, 2, 1], iter([0.25, 0.35, 0.2, 0.4, 0.3, 0.3])
    revisions = []
    with Phase('D1 first revision (2 MB)'):
        grow.write(int(2_000_000 * max(SCALE, 0.5)))
        h.uploaded('D1', h.collector.once('D r1'), 1, 1)
        session, head = h.stored('D r1', grow, 1, False)
        revisions.append(head)
    for group, count in enumerate(groups, start=1):
        with Phase(f'D2.{group} {count} append(s) while the job of revision {head["revision"]} runs'):
            def running_head():
                jobs = h.jobs(session)
                failed = [j for j in jobs if j['state'] == 'Failed' and j['error'] != 'superseded-revision']
                assert not failed, f'D: a job failed: {failed}'
                return next((j for j in jobs if j['revision'] == head['revision'] and j['state'] == 'Running' and j['completedWindows'] >= 1), None)
            running = h.wait(f'D group {group}', running_head, period=0.2)
            note(f'running job {json.dumps(running)}')
            for _ in range(count):
                previous = head
                grow.write(int(grow.bytes * next(growth)))
                h.uploaded(f'D r{previous["revision"] + 1}', h.collector.once(f'D r{previous["revision"] + 1}'), 1, 0)
                _, head = h.stored(f'D r{previous["revision"] + 1}', grow, previous['revision'] + 1, True, previous)
                revisions.append(head)
            still = next(j for j in h.jobs(session) if j['revision'] == running['revision'])
            check(f'D2.{group}: the job of revision {running["revision"]} is still running after revision {head["revision"]} committed',
                  still['state'] == 'Running', still)
    with Phase('D3 the head is indexed'):
        h.indexed('D3', session, head['revision'])
    jobs = h.jobs(session)
    created, completed = len(jobs), sum(1 for j in jobs if j['state'] == 'Complete')
    superseded = sum(1 for j in jobs if j['error'] == 'superseded-revision')
    check(f'D: {len(revisions)} revisions, {created} jobs: {completed} complete, {superseded} superseded while queued, none failed otherwise',
          len(revisions) >= 7 and created == len(revisions) and completed + superseded == created
          and all(j['state'] == 'Complete' or (j['error'] == 'superseded-revision' and j['completedWindows'] == 0) for j in jobs), jobs)
    spent = sum(j['completedWindows'] for j in jobs)
    head_windows = jobs[-1]['totalWindows']
    note(f'D: windows completed {spent} in total, head revision {head["revision"]} has {head_windows}')
    s2 = h.stop()
    h.stub.stop()
    return dict(revisions=[dict(revision=r['revision'], rawBytes=r['rawBytes'], messages=r['messages'], estimate=r['estimate'], parts=r['upload']['parts']) for r in revisions],
                jobs=jobs, windowsSpent=spent, headWindows=head_windows, delaySeconds=delay, budget=h.budget, servers=[s2])


def run_e(root):
    """Gate O (test-main-collector.sh, unchanged) against this tree's server: the server's heap bounded, -XX:+PrintGC and
    probed every 100 ms while it runs; the old collector's heap bounded with --trace-gc."""
    node, entry = packaged(os.environ['MAIN_COLLECTOR'])
    assert shutil.which('git') is not None, 'git on PATH (the collector reads repositories)'
    server_log, probe, collector_log = root / 'server-E.log', root / 'probe-E.txt', root / 'collector-E.log'
    server_wrapper, collector_wrapper = root / 'chronicle-server', root / 'chronicle-collector'
    python = shlex.quote(sys.executable)
    server_wrapper.write_text(f"""#!/usr/bin/env bash
if [[ ${{1-}} == serve || ${{1-}} == serve-standby ]]; then
  port=$({python} -c 'import json, sys; print(json.load(open(sys.argv[1]))["listenPort"])' "$2")
  {python} -c {shlex.quote(PROBE)} "http://127.0.0.1:$port/api/versions" {shlex.quote(str(probe))} {PROBE_PERIOD_MS} {PROBE_TIMEOUT_S} &
  {shlex.quote(str(SERVER))} -XX:MaxHeapSize=768m -XX:+PrintGC "$@" 2>&1 | tee -a {shlex.quote(str(server_log))}
  exit "${{PIPESTATUS[0]}}"
fi
exec {shlex.quote(str(SERVER))} "$@"
""")
    collector_wrapper.write_text(f"""#!/usr/bin/env bash
{shlex.quote(node)} --max-old-space-size={COLLECTOR_HEAP_MB} --trace-gc {shlex.quote(entry)} "$@" | tee -a {shlex.quote(str(collector_log))} | grep -v -E '^\\[[0-9]+:0x[0-9a-f]+\\]'
exit "${{PIPESTATUS[0]}}"
""")
    for wrapper in (server_wrapper, collector_wrapper):
        wrapper.chmod(0o700)
    started = time.monotonic()
    result = subprocess.run(['bash', 'chronicle/scripts/test-main-collector.sh'], env=dict(os.environ, CHRONICLE_SERVER=str(server_wrapper), MAIN_COLLECTOR=str(collector_wrapper),
                            CHRONICLE_CLI=str(CLI)), stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=1800)
    print(result.stdout, result.stderr[-4000:], sep='\n', flush=True)
    passed = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
    check('E: gate O passes against the S2 server', result.returncode == 0 and passed and passed[-1]['status'] == 'passed', result.returncode)
    rows = [line.split() for line in probe.read_text().splitlines()]
    answered = [i for i, row in enumerate(rows) if row[2] == '200']
    within = rows[answered[0]:answered[-1] + 1] if answered else []
    latencies = sorted(float(ms) for _, ms, status in within if status == '200')
    probe_summary = dict(probes=len(within), failures=sum(1 for row in within if row[2] != '200'), beforeReadiness=answered[0] if answered else len(rows),
                         afterStop=len(rows) - answered[-1] - 1 if answered else 0, maxMs=latencies[-1] if latencies else None, p99Ms=percentile(latencies, 0.99))
    log = server_log.read_text(errors='replace')
    gcs = [(kind, float(before), float(after), float(pause)) for _, kind, before, after, pause in GC.findall(log)]
    server = dict(label='E', binary=str(SERVER), heap='768m', mode='serve-standby (gate O)', outOfMemory=len(re.findall(r'OutOfMemoryError|Java heap space', log)),
                  peakLiveHeapMB=max((after for kind, _, after, _ in gcs if kind == 'Full'), default=None),
                  peakHeapAfterAnyCollectionMB=max((after for _, _, after, _ in gcs), default=None),
                  peakHeapBeforeCollectionMB=max((before for _, before, _, _ in gcs), default=None), probe=probe_summary)
    servers.append(server)
    text = collector_log.read_text(errors='replace') if collector_log.exists() else ''
    node_gcs = [(kind, float(before), float(after)) for kind, before, _, after, _ in NODE_GC.findall(text)]
    collector = dict(label='E main collector (all --once/--status runs)', heapLimitMB=COLLECTOR_HEAP_MB, outOfMemory='heap out of memory' in text,
                     peakLiveHeapMB=max((after for kind, _, after in node_gcs if kind == 'Mark-Compact'), default=None),
                     peakHeapBeforeCollectionMB=max((before for _, before, _ in node_gcs), default=None))
    collectors.append(collector)
    check(f'E: every /api/versions probe while the server ran answered within {PROBE_TIMEOUT_S:.0f} s ({probe_summary["probes"]} probes, max {probe_summary["maxMs"]} ms)',
          probe_summary['probes'] > 0 and probe_summary['failures'] == 0, probe_summary)
    check('E: no out-of-memory on either side', server['outOfMemory'] == 0 and not collector['outOfMemory'], (server, collector))
    return dict(gateO=passed[-1], wallSeconds=round(time.monotonic() - started, 1))


RUNS = {'A': (run_a, 25 * GiB), 'B': (run_b, 60 * GiB), 'D': (run_d, 2 * GiB), 'E': (run_e, 1 * GiB)}


def main():
    os.umask(0o077)
    run = sys.argv[1]
    function, space = RUNS[run]
    free = shutil.disk_usage(tempfile.gettempdir()).free
    check(f'{run}: {free / GiB:.0f} GiB free in {tempfile.gettempdir()} (needs {space * SCALE / GiB:.0f} GiB)', free >= space * SCALE)
    started, lsn = time.monotonic(), wal_lsn()
    with tempfile.TemporaryDirectory(prefix=f'upload-bounds-{run}-') as temporary:
        root = Path(temporary)
        try:
            outcome = function(root)
        except BaseException:
            for log in sorted(root.glob('server-*.log')):
                print(f'--- {log.name} (tail)', log.read_text(errors='replace')[-3000:], sep='\n', flush=True)
            raise
        finally:
            if EVIDENCE is not None:
                EVIDENCE.mkdir(parents=True, exist_ok=True)
                for name in [*root.glob('server-*.log'), *root.glob('probe-*.txt'), *root.glob('collector-*.err'), *root.glob('collector-*.result'), *root.glob('proxy.log')]:
                    shutil.copy(name, EVIDENCE / f'{run}-{name.name}')
            fixtures = du(root)
        for line in deferred:
            print('not ok -', line, flush=True)
        summary = dict(run=run, status='failed' if deferred else 'passed', failed=deferred, scale=SCALE, wallSeconds=round(time.monotonic() - started, 1), walBytes=wal_since(lsn), disk=disk(),
                       workDirBytesAtEnd=fixtures, checks=len(checks), phases=phases, servers=servers, collectors=collectors, outcome=outcome,
                       server=str(SERVER), serverSha256=hashlib.sha256(SERVER.read_bytes()).hexdigest(), collector=str(COLLECTOR), cli=str(CLI))
    print(json.dumps(summary, default=str), flush=True)
    sys.exit(1 if deferred else 0)


main()
