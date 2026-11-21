#!/usr/bin/env python3
"""Acceptance runs A, B, D, E and G of the ingest limits (docs/drafts/20261121-0055-ingest-limits-spec.md §9; U8's runs of
the append-only ingest extended); started by test-upload-bounds.sh, whose header has the invocation. Synthetic Pi
sessions only, generated here; the owned database of the with-service-postgres wrapper only; every process it starts is
stopped on exit."""
import base64, contextlib, datetime, hashlib, http.client, json, mmap, os, random, re, resource, secrets, shlex, shutil, signal, socket, subprocess, sys, tempfile
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
# Diagnostic only: the collector reaches the server through the logging proxy (U8's path) instead of directly.
PROXY = os.environ.get('UPLOAD_BOUNDS_PROXY') == '1'
# The landing stage the run accepts: `prefix` (L4, L1, L3, L6, L2) or `l5` (streamed indexing as well). Legs of a later
# stage are listed as outside the stage; a leg of the stage that cannot run is `not run` and the run is incomplete.
STAGES = ('prefix', 'l5')
STAGE = os.environ.get('UPLOAD_BOUNDS_STAGE', 'prefix')
assert STAGE in STAGES, f'UPLOAD_BOUNDS_STAGE must be one of {STAGES}'
# B only: the JSON summary (last line of the output) of an A run of the same tree, for the Archive search comparison.
COMPARE_A = Path(os.environ['UPLOAD_BOUNDS_COMPARE_A']) if os.environ.get('UPLOAD_BOUNDS_COMPARE_A') else None
# Where the run's large data goes (fixtures, collector state, downloads; the wrapper's --data-root holds the cluster's data
# directory): its own private directory under DATA_ROOT, removed at the end. Unset: TMPDIR.
DATA_ROOT = Path(os.environ['UPLOAD_BOUNDS_DATA_ROOT']).resolve(strict=True) if os.environ.get('UPLOAD_BOUNDS_DATA_ROOT') else None
WEB_ROOT = Path(os.environ['CHRONICLE_WEB_ROOT']).resolve(strict=True) if os.environ.get('CHRONICLE_WEB_ROOT') else None
CHROMIUM = Path(os.environ['CHRONICLE_CHROMIUM']).resolve(strict=True) if os.environ.get('CHRONICLE_CHROMIUM') else None

# Production values (spec §9): the server at the 8 GiB container's native default heap (80 %) with the default indexing
# budget (2^31 - 1, no configuration key); PostgreSQL with production's current settings (reports/deploy4/PREP.md).
PRODUCTION_HEAP = 6871947673
PRODUCTION_BUDGET = 2147483647
PRODUCTION_ROLE_SETTINGS = dict(statement_timeout='30s', lock_timeout='35s', idle_in_transaction_session_timeout='1min', work_mem='4MB')
PRODUCTION_MAX_WAL_SIZE = '1GB'
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
DISK_SAMPLE_S = 10
SMOKE_BUDGET = 96 * MiB
# Targets of spec §9: L3 Archive search of a rare literal, the 1 GiB and 4.4 GB runs' difference; L1 CLI download RSS;
# the dashboard download's renderer JS heap; L2 collector CPU of the A run's +5 % append.
ARCHIVE_RARE_SECONDS = 1.0
ARCHIVE_SPREAD_SECONDS = 0.2
ARCHIVE_SAMPLES = 3  # CLI calls per Archive search; the median is judged (one call is noisy on a loaded host)
CLI_DOWNLOAD_RSS = 128 * 10**6
RENDERER_HEAP = 64 * 10**6
APPEND_CPU_SECONDS = 10.0
DOWNLOAD_MIN_RATE = 5 * 10**6  # bytes per second: the download deadlines, generous for this host
NOT_RUN_EXIT = 3
# G (spec §9 as amended by the lead, round 2): the initial 1 GiB replacement ≤ 30 min, the growth and the edit ≤ 30 min,
# the whole run ≤ 60 min (RUNS).
GROWTH_APPENDS, GROWTH_PERCENT, G_UPLOAD_BUDGET_S, GROWTH_BUDGET_S = 20, 0.5, 30 * 60, 30 * 60
# Needles: letters the generated vocabulary never uses (j, k, q, w, x, y, z), so none occurs by chance.
COMMON = 'kobalt needle'
RARE = 'xyzzy quokka'
RARE_APPENDED = 'jinx wizzy'
NO_HIT = 'zyzzyva kumquat'
COMMON_EVERY, COMMON_AT = 101, 7

checks, phases, servers, collectors, deferred = [], [], [], [], []
not_run, outside_stage, clis = [], [], []
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


def skip(label, reason):
    """A leg of this stage that cannot run with these binaries: reported, and the run ends incomplete (never passed)."""
    not_run.append(f'{label}: {reason}')
    print('not run -', label, '-', reason, flush=True)


def hook(label, stage):
    """A leg of landing stage `stage` whose assertions come with a later phase. A run of an earlier stage lists it as
    outside its stage (returns True: the caller asserts that stage's expectation instead); a run of that stage or a later
    one reports it `not run`, so the run ends incomplete (returns False)."""
    if STAGES.index(STAGE) < STAGES.index(stage):
        outside_stage.append(f'{label} (stage {stage})')
        note(f'outside stage {STAGE}: {label} (stage {stage})')
        return True
    skip(label, f'its stage-{stage} assertion comes with phase 3')
    return False


def smoke_budget():
    """Development scale only: an indexing budget the shrunk large session still exceeds and the small ones fit."""
    return max(int(PRODUCTION_BUDGET * SCALE), SMOKE_BUDGET)


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


def production_postgres():
    """Applies production's current settings to the owned cluster (the service role's defaults in its database and
    max_wal_size, as the cluster's peer-authenticated administrator over its socket) and checks that a new service-role
    session sees exactly them."""
    role, database = DATABASE['user'], LOCATION[2]
    assert re.fullmatch(r'\w+', role), role
    statements = [f"ALTER ROLE \"{role}\" IN DATABASE \"{database}\" SET {name} = '{value}'" for name, value in PRODUCTION_ROLE_SETTINGS.items()]
    statements += [f"ALTER SYSTEM SET max_wal_size = '{PRODUCTION_MAX_WAL_SIZE}'", 'SELECT pg_reload_conf()']
    subprocess.run(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', str(OWNED / 'cluster/socket'), '-p', LOCATION[1], '-d', 'postgres', '-f', '-'],
                   input=';\n'.join(statements) + ';\n', capture_output=True, text=True, timeout=60, check=True)
    names = [*PRODUCTION_ROLE_SETTINGS, 'max_wal_size']
    result = subprocess.run(['psql', '-X', '-At', '-F', '|', '-h', '127.0.0.1', '-p', LOCATION[1], '-U', role, '-d', database, '-c',
                             'SELECT ' + ', '.join(f"current_setting('{name}')" for name in names)], capture_output=True, text=True, timeout=60, check=True,
                            env={**{k: v for k, v in os.environ.items() if k != 'PGOPTIONS'}, 'PGPASSWORD': Path(DATABASE['passwordFile']).read_text().strip()})
    seen = dict(zip(names, result.stdout.strip().split('|')))
    expected = {**PRODUCTION_ROLE_SETTINGS, 'max_wal_size': PRODUCTION_MAX_WAL_SIZE}
    check(f'PostgreSQL: a new service-role session has production\'s settings {json.dumps(expected)}', seen == expected, seen)
    return seen


def wal_lsn():
    return one('SELECT pg_current_wal_insert_lsn()')


def wal_since(lsn):
    return int(one("SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(), :'arg0')", lsn))


def du(path):
    """Bytes under `path`. WAL segments recycled during the walk make du complain and exit 1 with a meaningful total; no
    total at all is an error."""
    result = subprocess.run(['du', '-sb', str(path)], capture_output=True, text=True)
    fields = result.stdout.split()
    if not fields or not fields[0].isdigit():
        raise RuntimeError(f'du {path} gave no size (exit {result.returncode}): {result.stderr.strip()[-300:]}')
    return int(fields[0])


WORK = []  # the run's private directory: fixtures, collector state, logs


def cluster_bytes():
    """The owned cluster's directory and, when the wrapper moved it to its --data-root, the data directory there."""
    data = OWNED / 'cluster/data'
    return du(OWNED / 'cluster') + (du(data.resolve(strict=True)) if data.is_symlink() else 0)


def disk():
    return dict(database=int(one('SELECT pg_database_size(current_database())')), cluster=cluster_bytes(), workDir=du(WORK[0]) if WORK else 0)


class DiskPeak:
    """The largest cluster directory + work directory (fixtures included) seen every DISK_SAMPLE_S while a run lasts.
    `stop` fails when a sample failed or the sampler was not running until then, and adds a final measurement."""
    def __init__(self, measure):
        self.measure, self.peak, self.samples, self.error, self.done = measure, 0, 0, None, threading.Event()
        self.thread = threading.Thread(target=self.sample, daemon=True)
        self.thread.start()

    def sample(self):
        try:
            while True:
                self.peak, self.samples = max(self.peak, self.measure()), self.samples + 1
                if self.done.wait(DISK_SAMPLE_S):
                    return
        except BaseException as error:
            self.error = error

    def stop(self):
        alive = self.thread.is_alive()
        self.done.set()
        self.thread.join()
        if self.error is not None:
            raise RuntimeError(f'disk sampling failed after {self.samples} samples') from self.error
        if not alive:
            raise RuntimeError(f'disk sampling ended before the run did ({self.samples} samples)')
        return max(self.peak, self.measure())

    def abandon(self):
        self.done.set()
        self.thread.join()


def consumed_disk():
    return cluster_bytes() + du(WORK[0])


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
        pieces, length, j = [], -1, start  # the joined length: one separator fewer than pieces
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

    def edit(self, i):
        """Changes message i's line in place without changing its length (same inode, new content in the file's prefix),
        then re-hashes the file. Returns the line's byte offset."""
        old = self.line(i).encode('ascii')
        text = self.text(i)
        at = text.index(' ', len(f'Message {i}.')) + 1
        self.overrides[i] = text[:at] + 'EDITED' + text[at + len('EDITED'):]
        new = self.line(i).encode('ascii')
        assert len(new) == len(old) and new != old, (i, len(new), len(old))
        with open(self.path, 'r+b') as file, mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as content:
            offset = content.find(old)
            assert offset >= 0 and content.find(old, offset + 1) < 0, f'message {i} line not found once'
            assert os.pwrite(file.fileno(), new, offset) == len(new)
        self.digest = hashlib.sha256()
        with open(self.path, 'rb') as file:
            for chunk in iter(lambda: file.read(16 * MiB), b''):
                self.digest.update(chunk)
        return offset

    def sha256(self):
        return self.digest.hexdigest()

    def summary(self):
        return dict(bytes=self.bytes, messages=self.messages, records=self.messages + 1, large=sorted(self.large.values()))


# ---------------------------------------------------------------- processes

# One line per sample: epoch ms, monotonic start and end (s), status; `stop` once the stop file appeared. A writer
# thread owns the file, so a write held up by the disk (other processes' fsyncs) never delays the next sample.
PROBE = r'''
import os, queue, sys, threading, time, urllib.request
url, out, period, timeout, stop = sys.argv[1], sys.argv[2], int(sys.argv[3]) / 1000, float(sys.argv[4]), sys.argv[5]
lines = queue.SimpleQueue()
def write():
    with open(out, "a", buffering=1) as f:
        for line in iter(lines.get, None): f.write(line)
writer = threading.Thread(target=write); writer.start()
while not os.path.exists(stop):
    wall, t0 = time.time(), time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r: r.read(); status = r.status
    except Exception as e: status = type(e).__name__
    t1 = time.monotonic()
    lines.put(f"{int(wall * 1000)} {t0:.4f} {t1:.4f} {status}\n")
    time.sleep(max(0, period - (t1 - t0)))
lines.put("stop\n"); lines.put(None); writer.join()
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


def measured(args, env, timeout, sink=None):
    """Runs a command to its end: (exit status, stdout bytes, stderr text, peak RSS bytes, CPU s, wall s) from its own
    wait4 usage. `sink` consumes stdout as it arrives instead (nothing is kept)."""
    started = time.monotonic()
    with tempfile.TemporaryFile() as err:
        process = subprocess.Popen(args, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=err)
        killer = threading.Timer(timeout, process.kill)
        killer.start()
        out = bytearray()
        try:
            for chunk in iter(lambda: process.stdout.read(MiB), b''):
                if sink is None:
                    out += chunk
                else:
                    sink(chunk)
            _, status, usage = os.wait4(process.pid, 0)
        finally:
            killer.cancel()
            process.stdout.close()
        process.returncode = os.waitstatus_to_exitcode(status)
        err.seek(0)
        stderr = err.read().decode(errors='replace')
    return process.returncode, bytes(out), stderr, usage.ru_maxrss * KiB, usage.ru_utime + usage.ru_stime, time.monotonic() - started


def free_port():
    with socket.socket() as candidate:
        candidate.bind(('127.0.0.1', 0))
        return candidate.getsockname()[1]


def percentile(values, q):
    return values[min(len(values) - 1, int(q * len(values)))] if values else 0


def probe_samples(path):
    """(monotonic start, monotonic end, status, epoch ms) of every sample, and whether the probe stopped on request."""
    lines = path.read_text().splitlines() if path.exists() else []
    return [(float(start), float(end), status, int(wall)) for wall, start, end, status in (line.split() for line in lines if line != 'stop')], 'stop' in lines


def probe_coverage(samples, start, end, shutdown=False):
    """The interval [start, end] (monotonic s) is monitored when every sample that starts inside it is a 200 within the
    1 s deadline (monotonic elapsed time, not the socket timeout) and no stretch longer than two probe periods passes
    without a sample in flight or one completed within it. `shutdown`: the server was asked to stop at `end`, so a sample
    in flight then is not judged by its answer if it had run less than the deadline at `end` (its start still counts as
    coverage); one already overdue at `end` is a failure."""
    deadline = PROBE_TIMEOUT_S
    crossing = [s for s in samples if shutdown and s[0] <= end < s[1] and end - s[0] < deadline]
    measured = [s for s in samples if start <= s[0] <= end and s not in crossing]
    failures = [(round(a - start, 3), round((b - a) * 1000, 1), status) for a, b, status, _ in measured if status != '200' or b - a >= deadline]
    covered, gap = start, 0.0
    for sample in sorted(samples):
        a, b, status = sample[:3]
        if b < start or a > end:
            continue
        if sample in crossing:
            gap, covered = max(gap, a - covered), end
        elif status == '200' and b - a < deadline:
            gap, covered = max(gap, a - covered), max(covered, b)
    gap = max(gap, end - covered)
    latencies = sorted((b - a) * 1000 for a, b, status, _ in measured if status == '200')
    return dict(probes=len(measured), failures=len(failures), firstFailures=failures[:5], intervalSeconds=round(end - start, 1),
                maxGapMs=round(gap * 1000, 1), maxMs=round(latencies[-1], 1) if latencies else None, p99Ms=round(percentile(latencies, 0.99), 1),
                p999Ms=round(percentile(latencies, 0.999), 1), over500Ms=sum(1 for ms in latencies if ms > 500), allowedGapMs=2 * PROBE_PERIOD_MS)


def probe_ok(probe):
    return probe['probes'] > 0 and probe['failures'] == 0 and probe['maxGapMs'] <= probe['allowedGapMs'] and probe['aliveAtStop'] and probe['stoppedOnRequest']


class Probe:
    """GET /api/versions every 100 ms with a 1 s deadline, from before the server starts until it is asked to stop."""
    def __init__(self, root, label, origin):
        self.file, self.stop_file = root / f'probe-{label}.txt', root / f'probe-{label}.stop'
        self.process = subprocess.Popen([sys.executable, '-c', PROBE, origin + '/api/versions', str(self.file), str(PROBE_PERIOD_MS), str(PROBE_TIMEOUT_S),
                                         str(self.stop_file)], stdin=subprocess.DEVNULL, start_new_session=True)

    def stop(self, ready):
        """Coverage of [ready, now]: the server's measured interval, from its readiness to this stop request."""
        alive, requested = self.process.poll() is None, time.monotonic()
        self.stop_file.write_text('')
        try:
            self.process.wait(timeout=PROBE_TIMEOUT_S + 5)
        except subprocess.TimeoutExpired:
            stop_group(self.process, 5)
        samples, stopped = probe_samples(self.file)
        return dict(probe_coverage(samples, ready, requested), aliveAtStop=alive, stoppedOnRequest=stopped)


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
        self.probe = Probe(root, label, self.origin)
        self.started = time.monotonic()
        self.process = subprocess.Popen([str(binary), f'-XX:MaxHeapSize={heap}', '-XX:+PrintGC', 'serve', str(config)], stdin=subprocess.DEVNULL,
                                        stdout=log, stderr=subprocess.STDOUT, start_new_session=True, env=dict(os.environ, HOME=str(root / 'home')))
        log.close()
        deadline = time.monotonic() + 300
        while True:
            if self.process.poll() is not None:
                self.probe.stop(time.monotonic())
                raise AssertionError(f'the {label} server exited during start: {self.log_path.read_text()[-3000:]}')
            try:
                with urllib.request.urlopen(self.origin + '/api/versions', timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                pass
            assert time.monotonic() < deadline, 'server readiness'
            time.sleep(0.2)
        self.ready = time.monotonic()
        note(f'{label} server ready after {self.ready - self.started:.1f} s')
        running.append(self.process)

    def alive(self):
        return self.process.poll() is None

    def stop(self):
        probe = self.probe.stop(self.ready)
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
    """The tree's collector, `--once`, under --max-old-space-size=256 with --trace-gc, straight to the server (through the
    logging proxy only with UPLOAD_BOUNDS_PROXY=1). After every run its `--status --json` is read: no `report-failed`
    diagnostic may remain (U8 finding 1), and the per-source `lastPass` of the incremental append (spec §2.2 item 6) is
    looked up there."""
    def __init__(self, root, origin, token_file, max_file_bytes, max_messages):
        self.root, self.home = root, root / 'home'
        self.config = root / 'collector.json'
        self.proxy = Proxy(root, origin) if PROXY else None
        self.config.write_text(json.dumps(dict(enabled=True, endpoint=self.proxy.origin if PROXY else origin, tokenFile=str(token_file),
                                               stateDir=str(root / 'collector-state'), homeDir=str(self.home), discoverYolo=False, quietMs=0,
                                               uploadProtocol='parts', maxFileBytes=max_file_bytes, maxScanBytes=max_file_bytes, maxMessages=max_messages,
                                               maxRecordBytes=RECORD_BYTES)))
        self.env = {k: v for k, v in os.environ.items() if not k.startswith('CHRONICLE_') and k not in ('NODE_OPTIONS', 'NODE_PATH')}
        self.env.update(HOME=str(self.home))
        self.runs, self.last_status = 0, None

    def sessions(self, project):
        directory = self.home / '.pi/agent/sessions' / project
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def once(self, label):
        self.runs += 1
        out, err = self.root / f'collector-{self.runs}.out', self.root / f'collector-{self.runs}.err'
        started, before, mark = time.monotonic(), resource.getrusage(resource.RUSAGE_CHILDREN), len(self.proxy.lines()) if PROXY else 0
        with out.open('x') as stdout, err.open('x') as stderr:
            code = subprocess.run([NODE, f'--max-old-space-size={COLLECTOR_HEAP_MB}', '--trace-gc', str(COLLECTOR), '--config', str(self.config), '--once'],
                                  env=self.env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, timeout=7200).returncode
        wall, after = time.monotonic() - started, resource.getrusage(resource.RUSAGE_CHILDREN)
        cpu = after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime
        text = out.read_text()
        results = [line[line.index('{"'):] for line in text.splitlines() if '{"' in line]
        gcs = [(kind, float(before), float(after)) for kind, before, _, after, _ in NODE_GC.findall(text)]
        status = self.status()
        reports = [d for d in status.get('diagnostics', []) if d.get('code') == 'report-failed']
        summary = dict(label=label, exit=code, wallSeconds=round(wall, 1), cpuSeconds=round(cpu, 1), heapLimitMB=COLLECTOR_HEAP_MB,
                       peakLiveHeapMB=max((after for kind, _, after in gcs if kind == 'Mark-Compact'), default=None),
                       peakHeapBeforeCollectionMB=max((before for _, before, _ in gcs), default=None),
                       fullCollections=sum(1 for kind, _, _ in gcs if kind == 'Mark-Compact'),
                       outOfMemory='heap out of memory' in text + err.read_text(), path='logging proxy' if PROXY else 'direct',
                       requests=self.proxy.summary(mark) if PROXY else None, reportFailed=reports, reporting=status.get('reporting'))
        collectors.append(summary)
        note(json.dumps(summary))
        (self.root / f'collector-{self.runs}.result').write_text('\n'.join(line for line in text.splitlines() if not NODE_GC.search(line)) + '\n')
        if code != 0:
            note(f'{label}: collector result {results[-1] if results else None}')
            note(f'{label}: collector queue ' + json.dumps(status.get('queue'))[:4000])
            note(f'{label}: collector diagnostics ' + json.dumps(status.get('diagnostics'))[:4000])
        check(f'{label}: the collector prints its result, no out-of-memory, within {COLLECTOR_HEAP_MB} MB of heap',
              not summary['outOfMemory'] and results, (code, err.read_text()[-2000:], text[-2000:]))
        check(f'{label}: --once exits 0 (no upload failure, nothing left, no failed progress report; collector {summary["path"]})', code == 0,
              dict(exit=code, requests=summary['requests']), defer=True)
        check(f'{label}: no report-failed diagnostic after the run (collector {summary["path"]})', not reports, reports, defer=True)
        return json.loads(results[-1])

    def status(self):
        result = subprocess.run([NODE, f'--max-old-space-size={COLLECTOR_HEAP_MB}', str(COLLECTOR), '--config', str(self.config), '--status', '--json'],
                                env=self.env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=120, check=True)
        self.last_status = json.loads(result.stdout)
        return self.last_status

    def last_pass(self, fixture):
        """The `lastPass` of the fixture's file in `--status --json` `sources` after the latest run (C1: the entry whose
        pathId is the SHA-256 of the file's path), or None when the collector reports no `sources` (no incremental
        append)."""
        if 'sources' not in self.last_status:
            return None
        entries = [entry for entry in self.last_status['sources'] if entry['pathId'] in path_ids(fixture.path)]
        assert len(entries) == 1, f'lastPass of {fixture.path}: {json.dumps(self.last_status["sources"])[:2000]}'
        return entries[0]['lastPass']

    def diagnostics(self, code, fixture):
        return [d for d in self.last_status.get('diagnostics', []) if d.get('code') == code and d.get('pathId') in path_ids(fixture.path)]


def path_ids(path):
    """The collector's pathId of a file (SHA-256 of its path), as given and resolved."""
    return {hashlib.sha256(str(candidate).encode()).hexdigest() for candidate in (path, os.path.realpath(path))}


class Cli:
    """The tree's CLI; every call's peak RSS and wall time are recorded (`clis`)."""
    def __init__(self, root, origin, password_file):
        self.origin, self.env = origin, dict({k: v for k, v in os.environ.items() if not k.startswith('CHRONICLE_')}, HOME=str(root / 'home'),
                                             CHRONICLE_STATE_DIR=str(root / 'cli-state'))
        self.call('login', '--login', 'alice', '--password-file', str(password_file), expect=0)

    def run(self, args, sink=None, timeout=180, json_output=True):
        code, out, err, rss, cpu, wall = measured([str(CLI), '--url', self.origin, '--allow-insecure-http', *(['--json'] if json_output else []),
                                                   '--timeout-ms', '120000', *args], self.env, timeout, sink)
        clis.append(dict(command=args[0], exit=code, peakRssBytes=rss, cpuSeconds=round(cpu, 1), wallSeconds=round(wall, 2)))
        return code, out, err, rss, wall

    def call(self, *args, expect=0):
        code, out, err, _, elapsed = self.run(args)
        assert (code == 0) == (expect == 0), f'chronicle {args[0]}: exit {code}: {err[-2000:]} {out[-2000:].decode(errors="replace")}'
        return (json.loads(out) if expect == 0 else err), elapsed

    def result(self, *args):
        value, elapsed = self.call(*args, '--auth', 'session')
        return next(iter(value.values()))['result'], elapsed

    def downloads(self):
        """Whether this CLI has `raw --output` (spec §1.5)."""
        help_text, _ = self.call('help', 'raw')
        return '--output' in json.dumps(help_text)


def login_cookie(origin, password):
    """`chronicle_session=…` of a browser login as alice."""
    request = urllib.request.Request(origin + '/api/login', method='POST', data=json.dumps(dict(login='alice', password=password)).encode(),
                                     headers={'Content-Type': 'application/json', 'Origin': origin})
    with urllib.request.urlopen(request, timeout=30) as response:
        return next(value.split(';')[0] for name, value in response.headers.items() if name.lower() == 'set-cookie' and value.startswith('chronicle_session='))


class WebSocket:
    """A minimal WebSocket client: text messages, masked frames out, continuation and control frames in (pings answered)."""
    def __init__(self, host, port, path, headers=(), timeout=600):
        self.socket = socket.create_connection((host, int(port)), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        extra = ''.join(f'{name}: {value}\r\n' for name, value in headers)
        self.socket.sendall((f'GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n'
                             f'Sec-WebSocket-Version: 13\r\n{extra}\r\n').encode())
        head = b''
        while b'\r\n\r\n' not in head:
            chunk = self.socket.recv(1)
            assert chunk, f'websocket handshake: {head!r}'
            head += chunk
        assert head.startswith(b'HTTP/1.1 101'), head

    def exact(self, n):
        data = bytearray()
        while len(data) < n:
            chunk = self.socket.recv(min(n - len(data), MiB))
            assert chunk, 'socket closed'
            data += chunk
        return bytes(data)

    def frame(self, opcode, payload):
        mask = os.urandom(4)
        length = len(payload)
        header = bytes([0x80 | opcode]) + (bytes([0x80 | length]) if length < 126 else bytes([0x80 | 126]) + length.to_bytes(2, 'big') if length < 65536
                                            else bytes([0x80 | 127]) + length.to_bytes(8, 'big'))
        self.socket.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def send(self, value):
        self.frame(1, json.dumps(value).encode())

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

    def close(self):
        self.socket.close()


class Rpc:
    """The browser protocol over the minimal WebSocket client (cookie login, Hello, the server's Ping answered): failure
    messages, which the CLI replaces by its own text, and pages read both ways."""
    def __init__(self, origin, password):
        host, port = origin.removeprefix('http://').split(':')
        self.socket = WebSocket(host, port, '/api/ws', [('Origin', origin), ('Cookie', login_cookie(origin, password))])
        hello = self.call({'Hello': {'versions': ['1.9.0']}})
        assert 'Hello' in hello, hello

    def call(self, operation):
        request = str(uuid.uuid4())
        self.socket.send(dict(requestId=request, operation=operation))
        while True:
            envelope = self.socket.receive()
            if 'Ping' in envelope['result']:
                self.socket.send(dict(requestId=envelope['requestId'], operation={'Pong': envelope['result']['Ping']}))
            elif envelope['requestId'] == request:
                return envelope['result']

    def close(self):
        self.socket.close()


class Chromium:
    """Headless Chromium driven over the DevTools protocol (no dependency): opens the dashboard's session view with Info
    shown, clicks the raw download link with the mouse, and samples the page's JS heap until the browser has saved the
    file. A context manager owning its short private directory (profile, temporary files: Chromium's singleton socket),
    its process group and its DevTools socket from creation to shutdown: whatever fails, start included, each is released
    (browser closed, socket closed, group stopped, directory removed)."""
    def __init__(self, root, binary=None):
        self.root, self.binary, self.saved, self.log = root, binary or CHROMIUM, root / 'chromium-downloads', root / 'chromium.log'

    def __enter__(self):
        with contextlib.ExitStack() as stack:
            self.short = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix='acc-chromium-')))
            self.profile = self.short / 'profile'
            for directory in (self.profile, self.short / 'tmp'):
                directory.mkdir()
            self.saved.mkdir(exist_ok=True)
            with self.log.open('x') as log:
                self.process = subprocess.Popen([str(self.binary), '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                                                 '--disable-extensions', '--disable-background-networking', '--disable-sync', '--window-size=1600,1000',
                                                 '--remote-debugging-port=0', f'--user-data-dir={self.profile}', 'about:blank'],
                                                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                                                env=dict(os.environ, HOME=str(self.root / 'home'), TMPDIR=str(self.short / 'tmp')))
            stack.callback(stop_group, self.process, 10)
            active, deadline = self.profile / 'DevToolsActivePort', time.monotonic() + 60
            while not (active.exists() and len(active.read_text().splitlines()) == 2):
                assert self.process.poll() is None and time.monotonic() < deadline, f'chromium start: {self.log.read_text()[-2000:]}'
                time.sleep(0.1)
            port, path = active.read_text().splitlines()
            self.socket = WebSocket('127.0.0.1', port, path)
            stack.callback(self.socket.close)
            stack.callback(self.close_browser)
            self.sequence, self.events = 0, []
            self.release = stack.pop_all()
        return self

    def __exit__(self, kind, value, trace):
        self.release.close()

    def close_browser(self):
        try:
            self.call('Browser.close')
        except (AssertionError, OSError):
            pass

    def call(self, method, params=None, session=None):
        self.sequence += 1
        self.socket.send(dict(id=self.sequence, method=method, params=params or {}, **({'sessionId': session} if session else {})))
        while True:
            message = self.socket.receive()
            if message.get('id') == self.sequence:
                assert 'error' not in message, f'{method}: {message["error"]}'
                return message['result']
            if 'method' in message:
                self.events.append(message)

    def download(self, origin, cookie, session_id, revision, timeout):
        """(saved file, suggested name, peak JS heap of the page in bytes, heap samples, seconds from the click to the end)."""
        target = self.call('Target.createTarget', dict(url='about:blank'))['targetId']
        page = self.call('Target.attachToTarget', dict(targetId=target, flatten=True))['sessionId']
        name, value = cookie.split('=', 1)
        assert self.call('Network.setCookie', dict(name=name, value=value, url=origin + '/', httpOnly=True, sameSite='Strict'), page)['success']
        self.call('Browser.setDownloadBehavior', dict(behavior='allow', downloadPath=str(self.saved), eventsEnabled=True))
        self.call('Page.navigate', dict(url=f'{origin}/#/session/{session_id}?rev={revision}&pane=info'), page)
        href = f'/api/raw/{session_id}/{revision}/0'
        locate = ('(() => { const a = document.querySelector(\'a[download][href="' + href + '"]\'); if (!a) return null; a.scrollIntoView({block: "center"}); '
                  'const r = a.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2, text: a.textContent}; })()')
        deadline = time.monotonic() + 120
        while (link := self.call('Runtime.evaluate', dict(expression=locate, returnByValue=True), page)['result'].get('value')) is None:
            assert time.monotonic() < deadline, 'the dashboard shows no raw download link: ' + str(self.call('Runtime.evaluate', dict(
                expression='document.body.innerText.slice(0, 2000)', returnByValue=True), page)['result'].get('value'))
            time.sleep(0.2)
        clicked = time.monotonic()
        for kind in ('mouseMoved', 'mousePressed', 'mouseReleased'):
            self.call('Input.dispatchMouseEvent', dict(type=kind, x=link['x'], y=link['y'], button='left', clickCount=1), page)
        peak, samples, begun, state, deadline = 0, 0, None, None, time.monotonic() + timeout
        while state not in ('completed', 'canceled'):
            assert time.monotonic() < deadline, f'the browser download did not end within {timeout:.0f} s (state {state})'
            peak, samples = max(peak, int(self.call('Runtime.getHeapUsage', {}, page)['usedSize'])), samples + 1
            for event in self.events:
                if event['method'] == 'Browser.downloadWillBegin':
                    begun = event['params']
                elif event['method'] == 'Browser.downloadProgress' and begun is not None and event['params']['guid'] == begun['guid']:
                    state = event['params']['state']
            self.events.clear()
            if state not in ('completed', 'canceled'):
                time.sleep(0.5)
        elapsed = time.monotonic() - clicked
        peak = max(peak, int(self.call('Runtime.getHeapUsage', {}, page)['usedSize']))
        assert state == 'completed', f'the browser download ended {state}'
        return self.saved / begun['suggestedFilename'], begun['suggestedFilename'], peak, samples + 1, elapsed, link['text']


# ---------------------------------------------------------------- the server side of a run

class Harness:
    """One run's server side at the default bounds (spec §9): the default heap and indexing budget, the deployment limits."""
    def __init__(self, root, run):
        self.root, self.run, self.heap = root, run, PRODUCTION_HEAP
        self.budget = PRODUCTION_BUDGET if SCALE == 1 else smoke_budget()
        self.max_file_bytes = max_file_bytes = DEPLOYMENT_FILE_BYTES
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
                      maxBodyBytes=BODY_BYTES, maxFiles=16, maxFileBytes=max_file_bytes, maxMessages=DEPLOYMENT_MESSAGES, maxRecordBytes=RECORD_BYTES)
        for key in ('maxIndexingBudgetBytes', 'maxSmallJobBudgetBytes', 'maxRawReadBytes'):
            config.pop(key, None)
        if SCALE != 1:
            config.update(maxRawReadBytes=int(BODY_BYTES * SCALE), maxIndexingBudgetBytes=self.budget)
        config['annotation'].update(endpoint=self.stub.origin + '/v1/chat/completions', credentialFile=str(root / 'empty-credential'), model='stub-annotation',
                                    revision='upload-bounds', requestPolicy='strict-json-schema', timeoutSeconds=900, maxResponseBytes=1048576)
        config['embedding'].update(endpoint=self.stub.origin + '/v1/embeddings', credentialFile=str(root / 'empty-credential'), model='stub-embedding',
                                   revision='upload-bounds', dimensions=DIMENSIONS, sendDimensions=False, timeoutSeconds=60, maxResponseBytes=4 * MiB)
        self.config = root / 'server.json'
        self.config.write_text(json.dumps(config))
        self.server = None
        self.collector = Collector(root, self.origin, self.token_file, max_file_bytes, DEPLOYMENT_MESSAGES)
        note(f'run {run} (stage {STAGE}): server heap {self.heap} B, indexing budget {self.budget}{" (default)" if SCALE == 1 else " (development scale)"}, '
             f'maxFileBytes {max_file_bytes} (server and collector), maxMessages {DEPLOYMENT_MESSAGES}, maxRecordBytes {RECORD_BYTES}, '
             f'maxBodyBytes {BODY_BYTES}, collector heap {COLLECTOR_HEAP_MB} MB, collector {"through the logging proxy" if PROXY else "direct"}')

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
        check(f'{label} server: from readiness to stop ({probe["intervalSeconds"]} s) every /api/versions probe answered 200 in under {PROBE_TIMEOUT_S:.0f} s '
              f'({probe["probes"]} probes, max {probe["maxMs"]} ms) and none was missing for more than {probe["allowedGapMs"]} ms (longest {probe["maxGapMs"]} ms)',
              probe_ok(probe), probe)
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

    def incremental(self, label, fixture, delta):
        """L2 (spec §2.2 item 6): the collector parsed the append incrementally, exactly the appended bytes. None (and a
        `not run`) when the collector reports no lastPass at all."""
        last = self.collector.last_pass(fixture)
        if last is None:
            skip(f'{label}: lastPass.kind = incremental with parsedBytes = the {delta:,} appended bytes', 'the collector reports no lastPass (unit C1 not in this binary)')
            return None
        check(f'{label}: the collector\'s lastPass is incremental and parsed exactly the {delta:,} appended bytes ({json.dumps(last)})',
              last.get('kind') == 'incremental' and int(last.get('parsedBytes', -1)) == delta, last)
        return last

    def indexing(self, label, session, revision):
        """The head job's verdict at the default budget: `index-budget-exceeded` on the prefix (the whole session is held);
        streamed indexing (L5) is a later stage, whose assertions are hooks here."""
        if hook(f'{label}: the head job completes at the default heap, published at the head; semantic and hybrid search find the session', 'l5'):
            return self.budget_verdict(label, session, revision)
        return None

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

    def rpc(self, operation):
        """One operation on its own socket: an idle socket misses the server's 20 s heartbeat and is closed (1013)."""
        socket = Rpc(self.origin, self.password.read_text().strip())
        try:
            return socket.call(operation)
        finally:
            socket.close()

    def page(self, label, fixture, revision, page, elapsed, offset, client):
        n = fixture.messages
        got = page['messages']
        expected = [fixture.message(i) for i in range(offset, min(n, offset + PAGE))]
        sizes = [len(json.dumps(m, separators=(',', ':')).encode()) for m in expected]
        within = len(expected) if sum(sizes) <= MAX_PAGE_BYTES else next(i for i in range(len(sizes)) if sum(sizes[:i + 1]) > MAX_PAGE_BYTES)
        check(f'{label}: messages page at offset {offset:,} through {client} ({len(got)} messages, {sum(sizes[:len(got)]):,} B, {elapsed:.2f} s) equals the synthetic messages',
              got and got == expected[:len(got)] and len(got) >= min(within, len(expected)) and page['total'] == n and page['offset'] == offset
              and page['view']['revision'] == revision, dict(total=page['total'], offset=page['offset'], count=len(got), first=got[0]['id'] if got else None))

    def reads(self, label, fixture, session, revision, large_pages=(), targets=True):
        """Pages, locate, context, Find and Archive search answer from stored rows; GetRaw refuses with the exact size.
        Pages holding a large record are read through the CLI (L4: its bounds follow the server's page bound) and over
        the browser protocol, both exactly. `targets`: the L3 search time is asserted (not for the rollback binary)."""
        cli = self.reader()
        n = fixture.messages
        timings, observations = {}, {}
        regular = [offset for offset in (0, n // 2, n - PAGE) if not any(offset <= i < offset + PAGE for i in fixture.large)]
        for offset in regular:
            page, elapsed = cli.result('messages', session, '--revision', str(revision), '--offset', str(offset), '--limit', str(PAGE))
            self.page(label, fixture, revision, page, elapsed, offset, 'the CLI')
            timings[f'messages@{offset}'] = round(elapsed, 2)
        for offset in sorted({*large_pages, *(offset for offset in (0, n // 2, n - PAGE) if offset not in regular)}):
            started = time.monotonic()
            result = self.rpc({'GetMessages': dict(sessionId=session, offset=offset, limit=PAGE, view=dict(revision=revision, generationId=None))})
            elapsed = time.monotonic() - started
            check(f'{label}: the page at offset {offset:,} answers', 'Messages' in result, str(result)[:2000])
            self.page(label, fixture, revision, result['Messages']['result'], elapsed, offset, 'the browser protocol')
            timings[f'messages@{offset} (browser protocol)'] = round(elapsed, 2)
            page, elapsed = cli.result('messages', session, '--revision', str(revision), '--offset', str(offset), '--limit', str(PAGE))
            self.page(label, fixture, revision, page, elapsed, offset, 'the CLI (large record)')
            timings[f'messages@{offset} (CLI)'] = round(elapsed, 2)
            observations[f'CLI messages@{offset} peak RSS'] = clis[-1]['peakRssBytes']
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
                samples, answers = [], []
                for _ in range(ARCHIVE_SAMPLES):
                    result, elapsed = cli.result('archive', f'"{literal}" mode:lexical', '--limit', '10')
                    answers.append([row['head']['id'] for row in result['page']['rows']])
                    samples.append(round(elapsed, 2))
                elapsed = sorted(samples)[len(samples) // 2]
                check(f'{label}: Archive lexical search for the {name} literal returns the session each time (CLI {samples} s, median {elapsed:.2f} s)',
                      all(session in sessions for sessions in answers), answers)
                if targets:
                    check(f'{label}: that search took {elapsed:.2f} s (median), within the L3 target of {ARCHIVE_RARE_SECONDS} s', elapsed <= ARCHIVE_RARE_SECONDS,
                          dict(seconds=samples), defer=True)
                timings[f'archive {name}'] = elapsed
                observations[f'archive {name} samples'] = samples
        failure, elapsed = self.reader().call('raw', session, '--revision', str(revision), '--auth', 'session', expect=1)
        check(f'{label}: the CLI\'s raw answers too-large ({elapsed:.2f} s)', 'too-large' in failure, failure)
        started = time.monotonic()
        result = self.rpc({'GetRaw': dict(sessionId=session, revision=revision)})
        elapsed = time.monotonic() - started
        check(f'{label}: GetRaw answers too-large naming the exact size {fixture.bytes:,} ({elapsed:.2f} s)',
              json.dumps(result).count('too-large') == 1 and f'raw revision of {fixture.bytes} bytes' in json.dumps(result), result)
        note(f'{label}: read timings {json.dumps(timings)}')
        return dict(timings=timings, observations=observations)

    def downloads(self, label, fixture, session, revision):
        """L1 (spec §1): the revision's raw file downloaded byte-exact (SHA-256 and size of the fixture) over /api/raw by a
        streaming cookie client (with a ranged read of its last bytes), by the CLI to a file and to stdout (`raw --output`;
        peak RSS), and by Chromium through the dashboard's download link (renderer JS heap). Each saved copy is removed
        once checked."""
        timeout = max(600, fixture.bytes / DOWNLOAD_MIN_RATE)
        cookie = login_cookie(self.origin, self.password.read_text().strip())
        outcome = {}

        def get(path, headers=()):
            request = urllib.request.Request(self.origin + path, headers={'Cookie': cookie, **dict(headers)})
            return urllib.request.urlopen(request, timeout=120)
        with get(f'/api/raw/{session}/{revision}') as response:
            manifest = json.loads(response.read())
        files = manifest['files']
        check(f'{label}: the raw manifest names one file of {fixture.bytes:,} bytes with the fixture\'s SHA-256',
              manifest['revision'] == revision and len(files) == 1 and int(files[0]['bytes']) == fixture.bytes and files[0]['sha256'] == fixture.sha256(), manifest)
        digest, received, started = hashlib.sha256(), 0, time.monotonic()
        with get(f'/api/raw/{session}/{revision}/0') as response:
            headers = dict(response.headers.items())
            for chunk in iter(lambda: response.read(4 * MiB), b''):
                digest.update(chunk)
                received += len(chunk)
        elapsed = time.monotonic() - started
        check(f'{label}: GET /api/raw/…/0 with the cookie streams {received:,} bytes with the fixture\'s SHA-256 ({elapsed:.1f} s, '
              f'{received / max(elapsed, 1e-9) / 10**6:.0f} MB/s), Content-Length and ETag as specified',
              received == fixture.bytes and digest.hexdigest() == fixture.sha256() and int(headers['Content-Length']) == fixture.bytes
              and headers['ETag'] == f'"sha256:{fixture.sha256()}"', dict(received=received, headers=headers))
        outcome['http'] = dict(seconds=round(elapsed, 1), bytes=received)
        tail = min(fixture.bytes, MiB)
        with get(f'/api/raw/{session}/{revision}/0', [('Range', f'bytes={fixture.bytes - tail}-')]) as response:
            status, ranged, content_range = response.status, response.read(), response.headers['Content-Range']
        with open(fixture.path, 'rb') as file:
            file.seek(fixture.bytes - tail)
            expected = file.read(tail)
        check(f'{label}: a ranged read of the last {tail:,} bytes (from offset {fixture.bytes - tail:,}) answers 206 with exactly those bytes',
              status == 206 and ranged == expected and content_range == f'bytes {fixture.bytes - tail}-{fixture.bytes - 1}/{fixture.bytes}', (status, content_range))
        cli = self.reader()
        if not cli.downloads():
            skip(f'{label}: CLI raw --output FILE and --output - (SHA-256, peak RSS ≤ {CLI_DOWNLOAD_RSS / 10**6:.0f} MB)',
                 'this CLI has no raw --output (unit R2 not in this binary)')
        else:
            target = self.root / f'raw-{label.split()[0]}.jsonl'
            code, out, err, rss, wall = cli.run(['raw', session, '--revision', str(revision), '--output', str(target), '--auth', 'session'], timeout=timeout)
            saved = hashlib.sha256()
            with open(target, 'rb') if code == 0 else open(os.devnull, 'rb') as file:
                for chunk in iter(lambda: file.read(16 * MiB), b''):
                    saved.update(chunk)
            size = target.stat().st_size if code == 0 else None
            check(f'{label}: chronicle raw --output FILE exits 0 and saves {size} bytes with the fixture\'s SHA-256, its result naming them ({wall:.1f} s, '
                  f'peak RSS {rss / 10**6:.0f} MB)', code == 0 and size == fixture.bytes and saved.hexdigest() == fixture.sha256()
                  and fixture.sha256() in out.decode() and str(fixture.bytes) in out.decode(), (code, err[-2000:], out[-2000:]))
            check(f'{label}: raw --output FILE peak RSS {rss / 10**6:.0f} MB ≤ {CLI_DOWNLOAD_RSS / 10**6:.0f} MB', rss <= CLI_DOWNLOAD_RSS, rss, defer=True)
            target.unlink(missing_ok=True)
            outcome['cliFile'] = dict(seconds=round(wall, 1), peakRssBytes=rss)
            streamed, counted = hashlib.sha256(), [0]

            def consume(chunk):
                streamed.update(chunk)
                counted[0] += len(chunk)
            code, _, err, rss, wall = cli.run(['raw', session, '--revision', str(revision), '--output', '-', '--auth', 'session'], sink=consume, timeout=timeout,
                                              json_output=False)
            check(f'{label}: chronicle raw --output - exits 0 and writes {counted[0]:,} bytes with the fixture\'s SHA-256 ({wall:.1f} s, peak RSS {rss / 10**6:.0f} MB)',
                  code == 0 and counted[0] == fixture.bytes and streamed.hexdigest() == fixture.sha256(), (code, err[-2000:]))
            check(f'{label}: raw --output - peak RSS {rss / 10**6:.0f} MB ≤ {CLI_DOWNLOAD_RSS / 10**6:.0f} MB', rss <= CLI_DOWNLOAD_RSS, rss, defer=True)
            outcome['cliStdout'] = dict(seconds=round(wall, 1), peakRssBytes=rss)
        if CHROMIUM is None or WEB_ROOT is None:
            skip(f'{label}: dashboard download link in Chromium (SHA-256, renderer JS heap ≤ {RENDERER_HEAP / 10**6:.0f} MB)',
                 'CHRONICLE_CHROMIUM and CHRONICLE_WEB_ROOT are required for it')
        else:
            with Chromium(self.root) as browser:
                path, name, heap, samples, elapsed, text = browser.download(self.origin, cookie, session, revision, timeout)
            saved = hashlib.sha256()
            with open(path, 'rb') as file:
                for chunk in iter(lambda: file.read(16 * MiB), b''):
                    saved.update(chunk)
            size = path.stat().st_size
            path.unlink()
            check(f'{label}: the dashboard\'s Info link ({text!r}) downloads {name} in Chromium, {size:,} bytes with the fixture\'s SHA-256 ({elapsed:.1f} s)',
                  size == fixture.bytes and saved.hexdigest() == fixture.sha256() and name == f'chronicle-{session}-r{revision}-f0.jsonl', (name, size))
            check(f'{label}: the page\'s JS heap stayed at most {heap / 10**6:.1f} MB ≤ {RENDERER_HEAP / 10**6:.0f} MB during the download ({samples} samples)',
                  heap <= RENDERER_HEAP, heap, defer=True)
            outcome['chromium'] = dict(seconds=round(elapsed, 1), peakJsHeapBytes=heap, heapSamples=samples)
        note(f'{label}: downloads {json.dumps(outcome)}')
        return outcome


# ---------------------------------------------------------------- runs

def wal_per_raw_byte(phase_name, raw_bytes):
    """WAL bytes per raw byte of a phase (the replacement's), reported against L6 (spec §6.4: ≤ 7.5 B/B on the repo shape;
    this synthetic words shape: 20.0-20.4 B/B at the base), at max_wal_size 1 GB."""
    phase = next(p for p in phases if p['name'] == phase_name)
    value = round(phase['walBytes'] / raw_bytes, 2)
    note(f'{phase_name}: {value} B of WAL per raw byte ({phase["walBytes"]:,} B for {raw_bytes:,} B, max_wal_size {PRODUCTION_MAX_WAL_SIZE})')
    return value


def run_a(root):
    """A′ (1 GiB): replacement of 1,000,000,000 raw bytes, +5 % append (incremental with L2), the maxFileBytes boundary,
    a 16 MiB session that indexes, the head's indexing verdict, reads with the L3 search target, the L1 downloads; then the
    S2 -> S1 rollback (down-025, the S1 binary with workers) and the same verdicts."""
    s1 = Path(os.environ['CHRONICLE_S1_SERVER']).resolve(strict=True)
    h = Harness(root, 'A')
    big = Fixture(h.collector.sessions('--u8-a--') / 'big.jsonl', 'u8-a-big')
    small = Fixture(h.collector.sessions('--u8-a-small--') / 'small.jsonl', 'u8-a-small')
    started = time.monotonic()
    big.write(int(1_000_000_000 * SCALE), RARE)
    note(f'fixture big {json.dumps(big.summary())} in {time.monotonic() - started:.1f} s')
    h.start('A-S2')
    with Phase('A1 replacement upload of the 1 GB session'):
        h.uploaded('A1', h.collector.once('A1 replacement'), 1, 1)
        session, first = h.stored('A1', big, 1, False)
    wal = wal_per_raw_byte('A1 replacement upload of the 1 GB session', big.bytes)
    with Phase('A2 +5 % append'):
        delta = int(50_000_000 * SCALE)
        big.write(delta, RARE_APPENDED)
        h.uploaded('A2', h.collector.once('A2 append'), 1, 0)
        _, head = h.stored('A2', big, 2, True, first)
        if h.incremental('A2', big, delta) is not None:
            cpu = collectors[-1]['cpuSeconds']
            check(f'A2: the append cost the collector {cpu} s of CPU, within {APPEND_CPU_SECONDS} s', cpu <= APPEND_CPU_SECONDS, collectors[-1], defer=True)
    with Phase('A3 open at the maxFileBytes boundary'):
        identity = json.loads(one("SELECT source FROM ch_revision_info WHERE session_id=:'arg0' AND revision=2", session))
        identity['producerSessionId'] = 'u8-a-boundary'
        metadata = dict(title='upload bounds boundary', project=None, workdir=None, gitRemote=None, gitBranch=None, gitCommit=None, producer='upload-bounds',
                        model=None, startedAt=None, endedAt=None, tags=[])

        def declare(raw_bytes):
            return h.api('POST', '/api/ingest/uploads', dict(requestId=str(uuid.uuid4()), source=identity, expectedRevision=0, rawPath='boundary.jsonl', base=None,
                                                             digest=hashlib.sha256(b'').hexdigest(), rawBytes=str(raw_bytes), messageCount=0,
                                                             messageChain=hashlib.sha256(b'chronicle.message-chain.v1').hexdigest(), completion='Quiescent',
                                                             redacted=False, metadata=metadata))
        status, opened = declare(h.max_file_bytes)
        check(f'A3: an open declaring {h.max_file_bytes:,} raw bytes (= maxFileBytes) is accepted', status == 200 and opened['phase'] == 'Open', (status, opened))
        status, aborted = h.api('POST', f"/api/ingest/uploads/{opened['uploadId']}/abort")
        check('A3: that attempt aborts', status == 200 and aborted['phase'] == 'Aborted', (status, aborted))
        status, refused = declare(h.max_file_bytes + 1)
        check(f'A3: an open declaring {h.max_file_bytes + 1:,} raw bytes is refused 413 too-large', status == 413 and refused['code'] == 'too-large', (status, refused))
    with Phase('A4 a 16 MiB session indexes and publishes on the same server'):
        small.write(int(16 * MiB * SCALE))
        h.uploaded('A4', h.collector.once('A4 16 MiB session'), 1, 1)
        small_session, small_head = h.stored('A4', small, 1, False)
        check(f'A4: the 16 MiB session\'s estimate {small_head["estimate"]:,} is within the budget {h.budget:,}', small_head['estimate'] <= h.budget, small_head)
        small_job = h.indexed('A4', small_session, 1)
    with Phase('A5 indexing verdict of the 1 GB session'):
        if STAGE == 'prefix':
            check(f'A5: the 1 GB head\'s estimate {head["estimate"]:,} exceeds the budget {h.budget:,}', head['estimate'] > h.budget, head)
        h.indexing('A5', session, 2)
    with Phase('A6 reads of the 1 GB session (S2)'):
        a6 = h.reads('A6', big, session, 2)
    with Phase('A6 raw downloads of the 1 GB session (S2)'):
        a6_downloads = h.downloads('A6', big, session, 2)
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
        a8 = h.reads('A8', big, session, 2, targets=False)
        job_id, fence = one("SELECT id, fence FROM ch_jobs WHERE session_id=:'arg0' AND revision=2", session)
        h.reader().call('jobs', 'retry', job_id, '--yes', '--auth', 'session')
        h.wait('A8 retried job claimed', lambda: one("SELECT state='Failed' AND fence>:'arg1'::bigint FROM ch_jobs WHERE id=:'arg0'", job_id, fence) == 't')
        h.budget_verdict('A8 (S1, retried)', session, 2)
    s1_summary = h.stop()
    h.stub.stop()
    return dict(fixture=big.summary(), small=small.summary(), heads=dict(first=first, appended=head, small=small_head), smallJob=small_job,
                jobs=h.jobs(session), budget=h.budget, walPerRawByte=wal, reads=dict(S2=a6, S1=a8), downloads=a6_downloads, servers=[s2, s1_summary])


def run_b(root):
    """B′ (≥ 4 GiB): 4,400,000,000 raw bytes with records of 9-20 MiB (large parts), appended to, the collector direct
    (U8 finding 1); pages holding the large records through the CLI; downloads ≥ 4 GiB byte-exact; the L3 search target
    and its spread against an A run (UPLOAD_BOUNDS_COMPARE_A); the head's indexing verdict while other sessions index."""
    h = Harness(root, 'B')
    sizes, total = [int(9.5 * MiB), 12 * MiB, int(16.5 * MiB), 20 * MiB], int(4_400_000_000 * SCALE)
    if total > 2 * sum(sizes):
        expected = (total - sum(sizes)) // 5200
        large = {int(expected * at): size for at, size in zip((0.04, 0.36, 0.66, 0.94), sizes)}
    else:
        large = {(total - sizes[0]) // 5200 // 2: sizes[0]}
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
    wal = wal_per_raw_byte('B1 replacement upload of the 4.4 GB session and four small sessions', big.bytes + sum(f.bytes for f in smalls))
    with Phase('B2 append (+44,000,000 bytes with one 10 MiB record)'):
        big.large[big.messages + 100] = 10 * MiB
        before = big.bytes
        big.write(max(int(44_000_000 * SCALE), 24 * MiB), RARE_APPENDED)
        h.uploaded('B2', h.collector.once('B2 append'), 1, 0)
        _, head = h.stored('B2', big, 2, True, first)
        check('B2: the append carried its large record in a large part', head['upload']['largeParts'] >= 1, head['upload'])
        status, state = h.api('GET', f"/api/ingest/uploads/{head['upload']['id']}")
        check('B2: the append attempt reports its received bytes exactly', status == 200 and int(state['receivedRawBytes']) == big.bytes - first['rawBytes'], state)
        h.incremental('B2', big, big.bytes - before)
    with Phase('B3 indexing: the 4.4 GB session\'s verdict, the other sessions index'):
        if STAGE == 'prefix':
            check(f'B3: the head\'s estimate {head["estimate"]:,} exceeds the budget {h.budget:,}', head['estimate'] > h.budget, head)
        h.indexing('B3', session, 2)
        small_jobs = [h.indexed(f'B3 small session {k}', h.source(fixture)[0], 1) for k, fixture in enumerate(smalls)]
    with Phase('B4 reads of the 4.4 GB session'):
        b4 = h.reads('B4', big, session, 2, large_pages=[min(big.large) - PAGE // 2, max(i for i in big.large if i < first['messages']) - 10, max(big.large) - 1])
        if COMPARE_A is None:
            skip(f'B4: the rare-literal Archive search within {ARCHIVE_SPREAD_SECONDS} s of the A run\'s', 'UPLOAD_BOUNDS_COMPARE_A names no A summary')
        else:
            last = COMPARE_A.read_text().strip().splitlines()[-1] if COMPARE_A.exists() else ''
            if not last.startswith('{"run": "A"'):
                check(f'B4: UPLOAD_BOUNDS_COMPARE_A={COMPARE_A} ends with the summary of an A run', False, last[:200], defer=True)
            else:
                a = json.loads(last)
                a_seconds, b_seconds = a['outcome']['reads']['S2']['timings']['archive rare'], b4['timings']['archive rare']
                check(f'B4: the rare-literal Archive search took {b_seconds} s here and {a_seconds} s in the A run (scale {a["scale"]}; medians of '
                      f'{ARCHIVE_SAMPLES}), within {ARCHIVE_SPREAD_SECONDS} s of each other', abs(b_seconds - a_seconds) <= ARCHIVE_SPREAD_SECONDS and a['scale'] == SCALE,
                      dict(a=a_seconds, b=b_seconds, aScale=a['scale']), defer=True)
    with Phase('B5 raw downloads of the 4.4 GB session'):
        b5 = h.downloads('B5', big, session, 2)
    s2 = h.stop()
    h.stub.stop()
    return dict(fixture=big.summary(), heads=dict(first=first, appended=head), jobs=h.jobs(session), smallJobs=small_jobs, budget=h.budget, walPerRawByte=wal,
                reads=b4, downloads=b5, servers=[s2])


def run_d(root):
    """Growth while indexing: a 2 MB session grows by appends over 6 more revisions while its jobs run; it ends indexed at
    its head. Appends come in groups, each while a job of the then head revision runs (S0-I1: the running job continues,
    the head job waits; a queued job is superseded by the next append)."""
    h = Harness(root, 'D')
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
    hook('D′: windows annotated ≈ the head\'s windows plus the boundary windows (I2 reuse, L5d)', 'l5')
    s2 = h.stop()
    h.stub.stop()
    return dict(revisions=[dict(revision=r['revision'], rawBytes=r['rawBytes'], messages=r['messages'], estimate=r['estimate'], parts=r['upload']['parts']) for r in revisions],
                jobs=jobs, windowsSpent=spent, headWindows=head_windows, delaySeconds=delay, budget=h.budget, servers=[s2])


def run_e(root):
    """Gate O (test-main-collector.sh, unchanged) against this tree's server: the server at the default heap, -XX:+PrintGC and
    probed every 100 ms while it runs; the old collector's heap bounded with --trace-gc."""
    node, entry = packaged(os.environ['MAIN_COLLECTOR'])
    assert shutil.which('git') is not None, 'git on PATH (the collector reads repositories)'
    server_log, probe, probe_stop, collector_log = root / 'server-E.log', root / 'probe-E.txt', root / 'probe-E.stop', root / 'collector-E.log'
    term = root / 'server-E.term'
    server_wrapper, collector_wrapper = root / 'chronicle-server', root / 'chronicle-collector'
    python = shlex.quote(sys.executable)
    server_wrapper.write_text(f"""#!/usr/bin/env bash
if [[ ${{1-}} == serve || ${{1-}} == serve-standby ]]; then
  port=$({python} -c 'import json, sys; print(json.load(open(sys.argv[1]))["listenPort"])' "$2")
  setsid {python} -c {shlex.quote(PROBE)} "http://127.0.0.1:$port/api/versions" {shlex.quote(str(probe))} {PROBE_PERIOD_MS} {PROBE_TIMEOUT_S} {shlex.quote(str(probe_stop))} &
  {shlex.quote(str(SERVER))} -XX:MaxHeapSize={PRODUCTION_HEAP} -XX:+PrintGC "$@" > >(tee -a {shlex.quote(str(server_log))}) 2>&1 &
  server=$!
  # Gate O stops the server with SIGTERM to the group: the stop request's time ends the server's measured interval.
  trap 'LC_ALL=C; printf "%s\\n" "$EPOCHREALTIME" > {shlex.quote(str(term))}; kill -TERM "$server" 2>/dev/null' TERM
  wait "$server"; status=$?
  if [[ -e {shlex.quote(str(term))} ]]; then wait "$server"; status=$?; fi
  exit "$status"
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
    # The probe runs in its own session, so gate O's stop of the server does not end it. The server's measured interval
    # runs from the probe's first 200 to gate O's stop request (SIGTERM, recorded by the wrapper in wall-clock time and
    # placed on the probe's monotonic clock through the last sample before it); the probe must outlive it.
    time.sleep(5 * PROBE_PERIOD_MS / 1000)
    probe_stop.write_text('')
    deadline = time.monotonic() + PROBE_TIMEOUT_S + 5
    while not probe_samples(probe)[1] and time.monotonic() < deadline:
        time.sleep(0.1)
    samples, stopped = probe_samples(probe)
    answered = [s for s in samples if s[2] == '200']
    stop_wall = float(term.read_text().split()[0]) if term.exists() else None
    before = [s for s in samples if stop_wall is not None and s[3] / 1000 <= stop_wall]
    if answered and before:
        stop = before[-1][0] + stop_wall - before[-1][3] / 1000
        probe_summary = probe_coverage(samples, answered[0][0], stop, shutdown=True)
        probe_summary.update(beforeReadiness=samples.index(answered[0]), afterStop=sum(1 for s in samples if s[0] > stop),
                             aliveAtStop=any(s[0] > stop for s in samples), stoppedOnRequest=stopped)
    else:
        probe_summary = dict(probes=len(answered), failures=0, maxGapMs=None, allowedGapMs=2 * PROBE_PERIOD_MS, aliveAtStop=False,
                             stoppedOnRequest=stopped, stopRequestRecorded=stop_wall is not None)
    log = server_log.read_text(errors='replace')
    gcs = [(kind, float(before), float(after), float(pause)) for _, kind, before, after, pause in GC.findall(log)]
    server = dict(label='E', binary=str(SERVER), heap=PRODUCTION_HEAP, mode='serve-standby (gate O)', outOfMemory=len(re.findall(r'OutOfMemoryError|Java heap space', log)),
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
    check(f'E: while the server ran every /api/versions probe answered 200 in under {PROBE_TIMEOUT_S:.0f} s ({probe_summary["probes"]} probes, max '
          f'{probe_summary.get("maxMs")} ms), none was missing for more than {probe_summary["allowedGapMs"]} ms (longest {probe_summary["maxGapMs"]} ms), '
          f'and the probe outlived the server', probe_summary['maxGapMs'] is not None and probe_ok(probe_summary), probe_summary)
    check('E: no out-of-memory on either side', server['outOfMemory'] == 0 and not collector['outOfMemory'], (server, collector))
    # R2's raw read compatibility on the same owned database after gate O: tree server × base CLI, base server × tree
    # CLI, tree × tree byte-exact (its own servers, serve-standby, one after the other).
    compat_started = time.monotonic()
    compat = subprocess.run(['bash', 'chronicle/scripts/test-raw-compat.sh'], env=dict(os.environ, CHRONICLE_CLI=str(CLI)), stdin=subprocess.DEVNULL,
                            capture_output=True, text=True, timeout=1800)
    print(compat.stdout, compat.stderr[-4000:], sep='\n', flush=True)
    compat_checks = sum(1 for line in compat.stdout.splitlines() if line.startswith('ok -'))
    check(f'E: test-raw-compat.sh passes ({compat_checks} checks, {time.monotonic() - compat_started:.1f} s)', compat.returncode == 0 and compat_checks > 0,
          compat.returncode)
    return dict(gateO=passed[-1], rawCompatChecks=compat_checks, wallSeconds=round(time.monotonic() - started, 1))


def run_g(root):
    """G (spec §9): the 1 GiB session grows by 20 appends of +0.5 % through the collector's append path (with L2 each pass 1
    incremental over the delta; collector CPU per append); then a same-length in-place edit of a line in the middle of the
    file plus an append: the next upload is a replacement (L2 design (A): diagnostic `source-prefix-changed`) and the
    archive equals the file, the edited message included."""
    h = Harness(root, 'G')
    grow = Fixture(h.collector.sessions('--acc-g--') / 'grow.jsonl', 'acc-g-grow')
    started = time.monotonic()
    grow.write(int(1_000_000_000 * SCALE), RARE)
    note(f'fixture grow {json.dumps(grow.summary())} in {time.monotonic() - started:.1f} s')
    h.start('G-S2')
    upload_started = time.monotonic()
    with Phase('G1 replacement upload of the 1 GB session'):
        h.uploaded('G1', h.collector.once('G1 replacement'), 1, 1)
        session, head = h.stored('G1', grow, 1, False)
    upload = time.monotonic() - upload_started
    check(f'G1: the initial replacement upload took {upload / 60:.1f} min, within {G_UPLOAD_BUDGET_S / 60:.0f} min', upload <= G_UPLOAD_BUDGET_S,
          dict(seconds=round(upload, 1)), defer=True)
    growth_started, appends, incremental = time.monotonic(), [], True
    with Phase(f'G2 {GROWTH_APPENDS} appends of +{GROWTH_PERCENT} %'):
        step = int(1_000_000_000 * SCALE * GROWTH_PERCENT / 100)
        for k in range(1, GROWTH_APPENDS + 1):
            previous = head
            grow.write(step)
            h.uploaded(f'G2.{k}', h.collector.once(f'G2.{k} append'), 1, 0)
            _, head = h.stored(f'G2.{k}', grow, previous['revision'] + 1, True, previous)
            run = collectors[-1]
            last = h.incremental(f'G2.{k}', grow, step) if incremental else None
            incremental = incremental and last is not None
            appends.append(dict(revision=head['revision'], rawBytes=head['rawBytes'], parts=head['upload']['parts'], collectorCpuSeconds=run['cpuSeconds'],
                                collectorWallSeconds=run['wallSeconds'], lastPass=last))
    cpus = sorted(a['collectorCpuSeconds'] for a in appends)
    note(f'G2: collector CPU per append of {step:,} bytes: min {cpus[0]} s, median {cpus[len(cpus) // 2]} s, max {cpus[-1]} s')
    with Phase('G3 same-length edit of a line in the middle of the file, then an append'):
        edited = grow.messages // 2
        offset = grow.edit(edited)
        note(f'G3: message {edited} edited in place at byte {offset:,} of {grow.bytes:,}')
        grow.write(step)
        h.uploaded('G3', h.collector.once('G3 edit and append'), 1, 1)
        _, head = h.stored('G3', grow, head['revision'] + 1, False, head)
        page, elapsed = h.reader().result('messages', session, '--revision', str(head['revision']), '--offset', str(edited), '--limit', '1')
        check(f'G3: the archive\'s message {edited:,} is the edited text ({elapsed:.2f} s)', page['messages'] == [grow.message(edited)],
              dict(got=page['messages'][0]['text'][:200] if page['messages'] else None))
        if not incremental:
            skip('G3: the replacement reports source-prefix-changed once', 'the collector reports no lastPass (unit C1 not in this binary)')
        else:
            prefix = h.collector.diagnostics('source-prefix-changed', grow)
            check(f'G3: the collector reports source-prefix-changed once for the file ({len(prefix)})', len(prefix) == 1, prefix)
            last = h.collector.last_pass(grow)
            check(f'G3: the file\'s lastPass is a full pass for source-prefix-changed ({json.dumps(last)})',
                  last['kind'] == 'full' and last['reason'] == 'source-prefix-changed', last)
    growth = time.monotonic() - growth_started
    check(f'G: the growth and the edit took {growth / 60:.1f} min, within {GROWTH_BUDGET_S / 60:.0f} min', growth <= GROWTH_BUDGET_S,
          dict(seconds=round(growth, 1)), defer=True)
    s2 = h.stop()
    h.stub.stop()
    return dict(fixture=grow.summary(), appends=appends, editedMessage=edited, editOffset=offset, head=head, uploadSeconds=round(upload, 1), growthSeconds=round(growth, 1),
                servers=[s2])


# run: (function, free space it needs, wall-time budget s, consumed-disk budget B) — the budgets of spec §9 (G: the whole
# run; its initial upload and its growth with the edit are budgeted separately, G_UPLOAD_BUDGET_S and GROWTH_BUDGET_S).
RUNS = {'A': (run_a, 50 * GiB, 4 * 3600, 50 * 10**9), 'B': (run_b, 110 * GiB, 14 * 3600, 110 * 10**9), 'D': (run_d, 2 * GiB, 30 * 60, None),
        'E': (run_e, 1 * GiB, 15 * 60, None), 'G': (run_g, 25 * GiB, 60 * 60, 25 * 10**9)}


def main():
    os.umask(0o077)
    run = sys.argv[1]
    function, space, wall_budget, disk_budget = RUNS[run]
    data_root = DATA_ROOT or Path(tempfile.gettempdir())
    free = shutil.disk_usage(data_root).free
    check(f'{run}: {free / GiB:.0f} GiB free in {data_root} (needs {space * SCALE / GiB:.0f} GiB)', free >= space * SCALE)
    if DATA_ROOT is not None:
        data = (OWNED / 'cluster/data').resolve(strict=True)
        check(f'{run}: the cluster\'s data directory {data} is under the data root (the wrapper\'s --data-root)', data.is_relative_to(DATA_ROOT), data)
    settings = production_postgres()
    started, lsn = time.monotonic(), wal_lsn()
    with tempfile.TemporaryDirectory(prefix=f'upload-bounds-{run}-', dir=DATA_ROOT) as temporary:
        root = Path(temporary)
        WORK.append(root)
        sampler = DiskPeak(consumed_disk)
        try:
            outcome = function(root)
        except BaseException:
            sampler.abandon()
            for log in sorted(root.glob('server-*.log')):
                print(f'--- {log.name} (tail)', log.read_text(errors='replace')[-3000:], sep='\n', flush=True)
            raise
        finally:
            if EVIDENCE is not None:
                EVIDENCE.mkdir(parents=True, exist_ok=True)
                for name in [*root.glob('server-*.log'), *root.glob('probe-*.txt'), *root.glob('collector-*.err'), *root.glob('collector-*.result'), *root.glob('proxy.log'),
                             *root.glob('chromium.log')]:
                    shutil.copy(name, EVIDENCE / f'{run}-{name.name}')
            fixtures = du(root)
        wall = time.monotonic() - started
        consumed = sampler.stop()
        if wall_budget is not None:
            check(f'{run}: wall time {wall / 60:.1f} min within the budget of {wall_budget / 60:.0f} min', wall <= wall_budget, dict(wallSeconds=round(wall, 1)), defer=True)
        if disk_budget is not None:
            check(f'{run}: disk consumed at most {consumed / 10**9:.1f} GB (cluster and work directory with the fixtures, sampled every {DISK_SAMPLE_S} s) '
                  f'within the budget of {disk_budget / 10**9:.0f} GB, {sampler.samples} samples and a final measurement', consumed <= disk_budget,
                  dict(peakBytes=consumed, samples=sampler.samples), defer=True)
        for line in deferred:
            print('not ok -', line, flush=True)
        for line in not_run:
            print('not run -', line, flush=True)
        status = 'failed' if deferred else 'incomplete' if not_run else 'passed'
        cli_peak = max(clis, key=lambda c: c['peakRssBytes'], default=None)
        summary = dict(run=run, stage=STAGE, status=status, failed=deferred, notRun=not_run, outsideStage=outside_stage, scale=SCALE, wallSeconds=round(wall, 1),
                       walBytes=wal_since(lsn), disk=disk(), workDirBytesAtEnd=fixtures, peakDiskBytes=consumed, budgets=dict(wallSeconds=wall_budget, diskBytes=disk_budget),
                       checks=len(checks), postgres=settings, phases=phases, servers=servers, collectors=collectors, cliPeak=cli_peak, cliCalls=len(clis), outcome=outcome,
                       server=str(SERVER), serverSha256=hashlib.sha256(SERVER.read_bytes()).hexdigest(), collector=str(COLLECTOR), cli=str(CLI),
                       webRoot=str(WEB_ROOT) if WEB_ROOT else None, chromium=str(CHROMIUM) if CHROMIUM else None)
    print(json.dumps(summary, default=str), flush=True)
    sys.exit(1 if deferred else NOT_RUN_EXIT if not_run else 0)


if __name__ == '__main__':
    main()
