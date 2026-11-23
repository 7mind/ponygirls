#!/usr/bin/env python3
"""Restart acceptance of Chronicle, Haystack and Manure (docs/drafts/20261123-0055-restart-robustness-spec.md §9); started
by restart-acceptance.sh, whose header has the invocation, the pass rules and the verdict mechanics. Synthetic data only;
one PostgreSQL cluster this run creates under its own short temporary root; loopback ports it allocated; every process it
starts is stopped by PID on exit and the root is removed."""
import ast, base64, datetime, hashlib, http.client, json, os, pwd, random, re, secrets, select, shutil, signal, socket, subprocess, sys
import tempfile, threading, time, uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SERVICES = ('chronicle', 'haystack', 'manure')
SETS = ('SMALL', 'POOL')
ORDER = ('1', '2b', '2', '5', '6', '4', '3a', '3b', '3')  # the 3s last: they restart the cluster; 6 before them: its workers idle
# Rule set r4 (scope change, ORCH-REPLY-0430Z item 3): SMALL ships R-a reduced; its case-3 guarantee is 3a and 3b, the full
# design's case 3 is judged on the POOL/R-a2 run. A case not in the set's list runs only when named, and does not count.
CASES_OF = dict(SMALL=('1', '2b', '2', '5', '6', '4', '3a', '3b'), POOL=ORDER)

# The cluster: PostgreSQL 18 + pgvector, the spec's connection budget and roles (§5, §9).
SHORT_TMP, ROOT_PREFIX, MARKER = '/tmp', 'restart-acc.', '.restart-acceptance-owned'
MAX_CONNECTIONS, SUPERUSER_RESERVED, WORK_MEM = 64, 8, '4MB'
ROLE_LIMITS = dict(chronicle=12, haystack=8, manure=8)
ROLE_TIMEOUTS = dict(chronicle=dict(statementTimeoutMs=30000, lockTimeoutMs=35000, idleTransactionTimeoutMs=60000),
                     haystack=dict(statementTimeoutMs=30000, lockTimeoutMs=5000, idleTransactionTimeoutMs=30000),
                     manure=dict(statementTimeoutMs=30000, lockTimeoutMs=5000, idleTransactionTimeoutMs=30000))
# Fixture databaseLimits (the example configurations' values; maxConnections = the role limit, spec §5). Not a claim of
# parity with the chart: case 4 derives its answer bound from the configuration each process actually ran with.
SOCKET_TIMEOUT_MS = dict(chronicle=35000, haystack=40000, manure=40000)
LIMITS = {name: dict(maxConnections=ROLE_LIMITS[name], maxQueued=32, queueTimeoutMs=5000, connectTimeoutMs=5000,
                     socketTimeoutMs=SOCKET_TIMEOUT_MS[name], **ROLE_TIMEOUTS[name]) for name in SERVICES}
POOL_SIZE = dict(chronicle=10, haystack=6, manure=6)  # P of spec §5, case 6's POOL rule
START_PROBES = 1  # R-b's start-up login before the pool exists (spec §3), allowed on top of P in case 6's cold count
HAYSTACK_AUTH_RELOAD_MS = 2000
GENEROUS_RATE = 100000  # requests per minute: case 6 sends 1,000 per service
DIMENSIONS = 768

# Case parameters (spec §9).
PG_DELAY_S, READY_AFTER_PG_S = 10, 30                                   # 1
PROMOTE_AFTER_S, READY_AFTER_PROMOTE_S = 15, 30                         # 2
SHORT_WAIT_MS, EXIT_WINDOW_S = 10000, (10.0, 11.0)                      # 2b
SESSIONS, REQUEST_STATEMENT_MS, PUBLICATION_STATEMENT_MS = 20, 2000, 10000  # 3
TRIGGER_S, WINDOW_TRIGGER_S, WINDOW_S = 3, 12, 120
# Each restart fires at the first moment in its slot (seconds into the window) when a cohort publication sleeps in the
# trigger, at the slot's end otherwise.
RESTARTS = ((20, 45, 'fast'), (50, 80, 'immediate'), (85, 110, 'fast'))
RESTART_SLOT_S = 30  # case 3b: from the first cohort publication
LEASE_MARGIN_S = 10  # case 3b (r5, lead 05:46Z): the restart ends at least this long before an in-flight job's lease ends
COMPLETE_WITHIN_S = 20 * 60
FENCE_S, RECOVER_WITHIN_S, ANSWER_MARGIN_S = 30, 15, 1                  # 4: answers within queue + connect + 1 s
BIND_EXIT_S = 60                                                        # 5
REQUESTS, PGSTAT_FLUSH_S, IDLE_S, BACKEND_SAMPLE_S = 1000, 11, 30, 1    # 6
# Case 6's workload; a POOL run accepts only a SMALL calibration of the same workload.
WORKLOAD = dict(version=2, requestsPerService=REQUESTS, chronicle='MCP tools/call ingest_status', haystack='POST /api/v1/get (item GET)',
                manure='ListArtifacts', concurrency='the three services concurrently, each sequentially, a new connection per request',
                idleSeconds=IDLE_S, flushSeconds=PGSTAT_FLUSH_S)
# Mechanics bounds: exceeding one makes the case INVALID (the path was not exercised), never a reason to retry.
START_READY_S = 120          # a start with the database up (cases 3, 4, 6)
CASE_2B_OBSERVE_S = 60
FIRST_PUBLICATION_S = 300
REQUEST_RUN_S = 600
ZERO_SESSIONS_S = 30
LATCH_S = 15                 # case 4: the latch's locks granted, a role's backend waiting on them
TERMINATE_WAIT_MS, VANISH_S, INFLIGHT_S = 5000, 10, 60
CORRELATE_S = 30             # case 3: a hold line at most this long after its job's 57014
PG_CTL_S, STOP_GRACE_S, KILL_WAIT_S, SQL_S = 60, 30, 10, 60
PROBE_PERIOD_S, POLL_S, SAMPLE_S, RESTART_POLL_S = 1.0, 0.5, 1.0, 0.2
JOB_POLL_S = 5

# Lines. Chronicle's logger prefixes a line (`W 2026-… (Models.scala:416)  chronicle.Worker.process [thread] `) and renders
# an interpolated value as `label=name=value` (`code=code=worker-fault`): LOGGER and N= are those optional parts.
LOGGER = r'(?:[A-Z] \S+ \(\S+\)\s+\S+ \[[^\]]*\] )?'
N = r'(?:[A-Za-z_][\w.]*=)?'
SQLSTATE, CODE = r'[0-9A-Z]{5}', r'(?:jdbc-[0-9A-Z]{5}|[a-z][a-z0-9-]{0,63})'
UUID_TEXT = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
READY = dict(chronicle=re.compile(rf'^{LOGGER}chronicle listening address='), haystack=re.compile(r'^haystack: ready$'),
             manure=re.compile(r'^MANURE_READY \{.*\}$'))
WAIT = re.compile(rf'^{LOGGER}(chronicle|haystack|manure) database-wait code={N}({CODE})$')
WAIT_READY = re.compile(rf'^{LOGGER}(chronicle|haystack|manure) database-wait ready seconds={N}(\d+)$')
FAILURE = re.compile(rf'^(chronicle|haystack|manure) failure stage=([a-z][a-z0-9-]*) code=({CODE}) error=([A-Za-z_$][\w$]*) message="([^"]*)"(?: port=(\d+))?$')
HELD = re.compile(rf'^{LOGGER}job held jobId={N}({UUID_TEXT}) code={N}database-transient sqlState={N}({SQLSTATE}|none) class={N}([A-Za-z_$][\w$.]*) '
                  rf'stage={N}([A-Za-z][\w-]*) consecutive={N}([1-9]\d*) nextAttemptAt={N}(\S+)$')
TERMINAL = re.compile(rf'^{LOGGER}job failed jobId={N}({UUID_TEXT}) code={N}database-transient sqlState={N}({SQLSTATE}|none) class={N}([A-Za-z_$][\w$.]*) '
                      rf'stage={N}([A-Za-z][\w-]*) consecutive={N}([1-9]\d*) nextAttemptAt={N}none$')
ANSI = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')
# The trigger functions' server-log events (case 3), log_line_prefix '%m [%p] %q%u@%d ' with log_timezone UTC.
EVENT = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}) UTC \[(\d+)\] chronicle@chronicle LOG:  restart-acc (start|cancelled|done|request) '
                   r'sessions=(\S*) seconds=(\S+) statement_timeout=(\S+)$')
# Every server-log line (prefix, then `LOG:  …`, `FATAL:  …` with an optional user@database), and the postmaster's
# shutdown request and readiness (the markers of a restart).
LOG_LINE = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}) UTC \[(\d+)\] (?:\S+@\S+ )?(.*)$')
SHUTDOWN_REQUEST = dict(fast='LOG:  received fast shutdown request', immediate='LOG:  received immediate shutdown request')
READY_TO_ACCEPT = 'LOG:  database system is ready to accept connections'
SHUTDOWN_FATAL = 'FATAL:  terminating connection due to administrator command'
SHUTDOWN_SIGNALS = dict(fast=signal.SIGINT, immediate=signal.SIGQUIT)
RESTART_SQLSTATE = re.compile(r'^(?:08[0-9A-Z]{3}|57P0[123])$')  # what a restart gives the statement it interrupts
# psql's connection failure texts (lc_messages C) and their SQLSTATEs: how the cluster answered a new login.
LOGIN_STATES = (('the database system is starting up', '57P03'), ('the database system is not accepting connections', '57P03'),
                ('the database system is not yet accepting connections', '57P03'), ('the database system is shutting down', '57P03'),
                ('is not permitted to log in', '28000'), ('too many connections', '53300'), ('sorry, too many clients', '53300'),
                ('Connection refused', '08001'))
TOO_MANY = re.compile(r'too many connections for role|sorry, too many clients already')
HAYSTACK_KEY = 'restart:probe'
HAYSTACK_DOCUMENT = json.dumps(dict(title='restart probe', description='synthetic', fields={}, type='fact', status='actual', importance='low',
                                    **{'human-attention': 'cleared'}, links=[], tags=[]))
NIL = str(uuid.UUID(int=0))
UPLOAD_LIMITS = {'maxPartBytes', 'maxLargePartBytes', 'maxRecordBytes', 'maxRawBytes', 'maxMessages'}


def note(message):
    print('#', message, flush=True)


def now():
    return time.monotonic()


def sleep_until(instant):
    time.sleep(max(0.0, instant - now()))


class Refused(Exception):
    """Something this run does not own: never adopted, signalled, administered or sent credentials."""


# ---------------------------------------------------------------- ownership

class Root:
    """The run's private temporary root, created here; its marker holds this run's nonce. Every path the run writes,
    administers or removes must lie inside it."""
    def __init__(self):
        self.path = Path(tempfile.mkdtemp(prefix=ROOT_PREFIX, dir=SHORT_TMP)).resolve(strict=True)
        self.nonce = secrets.token_hex(16)
        (self.path / MARKER).write_text(self.nonce + '\n')

    def owned(self, path):
        candidate, marker = Path(path).resolve(), self.path / MARKER
        if not candidate.is_relative_to(self.path) or not marker.is_file() or marker.read_text() != self.nonce + '\n':
            raise Refused(f'not inside this run\'s root: {candidate}')
        return candidate

    def remove(self):
        shutil.rmtree(self.owned(self.path))


def clean_env(**extra):
    """PostgreSQL tools and the provider never see an inherited libpq (PG*: PGHOSTADDR, PGSERVICE, PGPASSFILE, …) or
    provider (PONYGIRLS_*: PONYGIRLS_PASSWORD_FILE) override: they reach this run's cluster only."""
    return {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'PONYGIRLS_'))} | dict(LC_ALL='C') | extra


def free_port():
    with socket.socket() as candidate:
        candidate.bind(('127.0.0.1', 0))
        return candidate.getsockname()[1]


def closed(port):
    """Nothing listens on the loopback port: a connection is refused."""
    with socket.socket() as probe:
        probe.settimeout(2)
        try:
            probe.connect(('127.0.0.1', port))
        except ConnectionRefusedError:
            return True
        return False


def tcp_sockets():
    """(state, local port, remote port, inode) of every TCP socket, IPv4 and IPv6 (/proc/net/tcp, tcp6)."""
    for table in ('/proc/net/tcp', '/proc/net/tcp6'):
        with open(table) as file:
            next(file)
            for line in file:
                fields = line.split()
                yield fields[3], int(fields[1].rsplit(':', 1)[1], 16), int(fields[2].rsplit(':', 1)[1], 16), int(fields[9])


def socket_inodes(pid):
    found = set()
    for fd in os.listdir(f'/proc/{pid}/fd'):
        try:
            target = os.readlink(f'/proc/{pid}/fd/{fd}')
        except OSError:
            continue
        if target.startswith('socket:['):
            found.add(int(target[8:-1]))
    return found


def holds_listener(port, pid):
    """Every TCP listener on the port (any address, IPv4 or IPv6) is a socket the process holds, and there is one."""
    listening = {inode for state, local, _, inode in tcp_sockets() if state == '0A' and local == port}
    try:
        return bool(listening) and listening <= socket_inodes(pid)
    except OSError:
        return False


def owned_listener(port, pid):
    """Credentials and probes go only to a port that the process this run started holds alone, checked right before."""
    if not holds_listener(port, pid):
        raise Refused(f'port {port} is not held by process {pid} alone')


def time_wait(port):
    """TCP sockets in TIME_WAIT with the port as source or destination."""
    return sum(1 for state, local, remote, _ in tcp_sockets() if state == '06' and port in (local, remote))


def spawn(args, **options):
    """A process of this run in its own session, with a pidfd taken at once: its identity for every later signal."""
    process = subprocess.Popen(args, start_new_session=True, **options)
    process.pidfd = os.pidfd_open(process.pid)
    return process


def send(pidfd, signum):
    """Signals exactly the process the pidfd was opened for; False once it has exited (a reused PID is never hit)."""
    try:
        signal.pidfd_send_signal(pidfd, signum)
        return True
    except ProcessLookupError:
        return False


def gone(pidfd, seconds):
    """Whether the process exited within `seconds` (a pidfd polls readable on exit, also for a non-child)."""
    poller = select.poll()
    poller.register(pidfd, select.POLLIN)
    return bool(poller.poll(seconds * 1000))


def stop_group(process, grace):
    """TERM to the process (identified by its pidfd), KILL after `grace` seconds; both waits bounded. The processes this run
    starts are single processes (the packaged wrappers exec the executable)."""
    if send(process.pidfd, signal.SIGTERM):
        try:
            process.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            send(process.pidfd, signal.SIGKILL)
            process.wait(timeout=KILL_WAIT_S)


# ---------------------------------------------------------------- cluster

class Cluster:
    """The run's own PostgreSQL 18 cluster (nix/postgres/provider.py's init and provisioning: the roles' CONNECTION LIMIT
    and role settings). Every operation first checks that the data directory is this run's and that a running
    postmaster is this run's (postmaster.pid names this data directory and port)."""
    def __init__(self, root, out):
        self.root, self.bin = root, Path(os.environ['PG_BIN'])
        self.state = root.path / 'pg'
        self.data, self.socket = self.state / 'data', self.state / 'socket'
        self.config, self.hba, self.manifest = root.path / 'postgresql.conf', root.path / 'pg_hba.conf', root.path / 'provider.json'
        self.secrets = {name: root.path / 'secrets' / name for name in SERVICES}
        self.log = out / 'postgres.log'
        self.admin = pwd.getpwuid(os.getuid()).pw_name
        self.port = free_port()
        self.standby, self.pidfd, self.postmaster = False, None, None

    def owned_data(self):
        self.root.owned(self.data)
        provider = self.state / 'ponygirls-provider-v1'
        if not provider.is_file() or provider.read_text() != 'postgresql-18\n':
            raise Refused(f'{self.state} is not a cluster this run initialized')
        pid_file = self.data / 'postmaster.pid'
        if pid_file.exists():
            lines = pid_file.read_text().splitlines()
            if len(lines) < 4 or Path(lines[1]) != self.data or lines[3].strip() != str(self.port):
                raise Refused(f'{pid_file} names another data directory or port')

    def init(self):
        if not closed(self.port):
            raise Refused(f'PostgreSQL port {self.port} is taken')
        databases = {name: dict(name=name, user=name, schemas=['public', 'manure'] if name == 'manure' else ['public'], passwordFile=str(self.secrets[name]),
                                createPassword=True, maxConnections=ROLE_LIMITS[name], workMem=WORK_MEM, **ROLE_TIMEOUTS[name]) for name in SERVICES}
        self.manifest.write_text(json.dumps(dict(stateDirectory=str(self.state), port=self.port, adminRole=self.admin, postgresBin=str(self.provider_bin()),
                                                 adminReserve=SUPERUSER_RESERVED, databases=databases)))
        self.hba.write_text(f'local all "{self.admin}" peer\n' + ''.join(f'local {name} {name} scram-sha-256\n' for name in SERVICES) + 'local all all reject\n'
                            + ''.join(f'host {name} {name} 127.0.0.1/32 scram-sha-256\n' for name in SERVICES)
                            + 'host all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n')
        settings = dict(listen_addresses="'127.0.0.1'", port=self.port, unix_socket_directories=f"'{self.socket}'", unix_socket_permissions='0700',
                        hba_file=f"'{self.hba}'", password_encryption="'scram-sha-256'", max_connections=MAX_CONNECTIONS,
                        superuser_reserved_connections=SUPERUSER_RESERVED, shared_buffers="'128MB'", work_mem=f"'{WORK_MEM}'", wal_level="'replica'",
                        lc_messages="'C'", log_timezone="'UTC'", log_line_prefix="'%m [%p] %q%u@%d '", logging_collector='off')
        self.config.write_text(''.join(f'{key} = {value}\n' for key, value in settings.items()))
        self.provider('init')
        self.start()
        for name in SERVICES:
            self.provider('provision', name)

    def provider_bin(self):
        """The provider's PostgreSQL tools: PG_BIN's, except a psql that sends the provider's TCP password probe
        (`-h 127.0.0.1`) to this run's private Unix socket instead (scram-sha-256 for the role there), so the role's
        password never reaches a TCP listener."""
        tools = self.root.owned(self.root.path / 'provider-bin')
        tools.mkdir(mode=0o700)
        for entry in self.bin.iterdir():
            if entry.name != 'psql':
                (tools / entry.name).symlink_to(entry)
        psql = tools / 'psql'
        psql.write_text(f'''#!{shutil.which('bash')}
args=()
while (($#)); do
  if [[ $1 == -h && ${{2-}} == 127.0.0.1 ]]; then args+=(-h '{self.socket}'); shift 2; else args+=("$1"); shift; fi
done
exec '{self.bin / 'psql'}' "${{args[@]}}"
''')
        psql.chmod(0o700)
        return tools

    def provider(self, *args):
        result = subprocess.run([sys.executable, str(REPO / 'nix/postgres/provider.py'), args[0], str(self.manifest), *args[1:]], capture_output=True, text=True,
                                timeout=180, env=clean_env())
        assert result.returncode == 0, f'provider {args[0]}: {result.stderr[-500:]}'

    def ctl(self, *args):
        self.owned_data()
        result = subprocess.run([str(self.bin / 'pg_ctl'), '-D', str(self.data), *args], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, timeout=PG_CTL_S + 30, env=clean_env())
        assert result.returncode == 0, f'pg_ctl {args[0]}: {result.stdout[-800:]}'
        return result.stdout

    def options(self, standby):
        return f'-c config_file={self.config}' + (' -c hot_standby=off' if standby else '')

    def running(self):
        """This run's postmaster runs: the identity captured when it started is alive (pg_ctl status would probe the
        number in postmaster.pid)."""
        self.owned_data()
        return self.pidfd is not None and not gone(self.pidfd, 0)

    def start(self, standby=False):
        """pg_ctl start (it signals nothing), then the new postmaster's identity is captured."""
        self.owned_data()
        if not closed(self.port):
            raise Refused(f'PostgreSQL port {self.port} is taken')
        if standby:
            (self.data / 'standby.signal').write_text('')
        self.ctl('start', '-l', str(self.log), '-o', self.options(standby), '-w', '-t', str(PG_CTL_S))
        self.standby = standby
        self.capture()

    def capture(self):
        """A pidfd of the postmaster pg_ctl just started: postmaster.pid's PID whose command line names this run's
        configuration file, checked again after opening. Every later signal to the postmaster goes through it."""
        pid = self.pid()
        mine = lambda: Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0').count(f'config_file={self.config}'.encode()) == 1
        assert pid is not None and mine(), 'the started postmaster is not identifiable as this run\'s'
        pidfd = os.pidfd_open(pid)
        if not mine():
            os.close(pidfd)
            raise AssertionError('the postmaster changed while its identity was taken')
        self.pidfd, self.postmaster = pidfd, pid

    def identified(self):
        """The captured postmaster identity; without one nothing is signalled (Refused)."""
        self.owned_data()
        if self.pidfd is None:
            raise Refused('no postmaster identity captured by this run: not signalled')
        return self.pidfd

    def stop(self, mode='fast'):
        """pg_ctl stop's shutdown request (fast SIGINT, immediate SIGQUIT) through the captured identity, then its exit
        awaited; a postmaster.pid without a captured identity is refused."""
        self.owned_data()
        if self.pidfd is None and not (self.data / 'postmaster.pid').exists():
            return
        if send(self.identified(), SHUTDOWN_SIGNALS[mode]):
            assert gone(self.pidfd, PG_CTL_S), f'the postmaster did not stop within {PG_CTL_S} s'
        os.close(self.pidfd)
        self.pidfd = self.postmaster = None

    def restart(self, mode):
        """pg_ctl restart's two steps: the shutdown through the captured identity, then a start with the same options."""
        self.stop(mode)
        self.start(self.standby)

    def promote(self):
        """pg_ctl promote's protocol through the captured identity: the promote file, SIGUSR1; then the end of recovery."""
        (self.data / 'promote').write_text('')
        assert send(self.identified(), signal.SIGUSR1), 'the postmaster is gone'
        deadline = now() + PG_CTL_S
        while True:
            try:
                if self.sql('postgres', 'SELECT pg_is_in_recovery()')[0][0] == 'f':
                    break
            except AssertionError:
                pass
            assert now() < deadline, f'recovery did not end within {PG_CTL_S} s of the promotion'
            time.sleep(POLL_S)
        self.standby = False

    def primary(self):
        """Running as a primary (pg_ctl restart is always given the normal options)."""
        if self.running() and not self.standby:
            return
        self.stop()
        (self.data / 'standby.signal').unlink(missing_ok=True)
        self.start()

    def as_standby(self):
        if self.running() and self.standby:
            return
        self.stop()
        self.start(standby=True)

    def pid(self):
        self.owned_data()
        pid_file = self.data / 'postmaster.pid'
        return int(pid_file.read_text().split('\n', 1)[0]) if pid_file.exists() else None

    def psql(self, database):
        return [str(self.bin / 'psql'), '-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-h', str(self.socket), '-p', str(self.port), '-U', self.admin,
                '-d', database]

    def sql(self, database, query, timeout=SQL_S):
        """Rows of an administrator query over this cluster's own socket (peer authentication)."""
        self.owned_data()
        result = subprocess.run([*self.psql(database), '-f', '-'], input=query + ';\n', capture_output=True, text=True, timeout=timeout,
                                env=clean_env(PGCONNECT_TIMEOUT='5', PGOPTIONS='-c statement_timeout=0'))
        assert result.returncode == 0, f'administrator query: {result.stderr[-500:]}'
        return [line.split('|') for line in result.stdout.splitlines()]

    def owned_port(self):
        """A role password goes over TCP only to a port that the identified postmaster holds alone."""
        if not send(self.identified(), 0) or not holds_listener(self.port, self.postmaster):
            raise Refused(f'port {self.port} is not held by this run\'s postmaster')

    def login_state(self, role):
        """How the cluster answers a new login as the role over TCP: 'ok' or the SQLSTATE of psql's failure text. The role's
        password goes only to a port that the identified postmaster holds alone."""
        self.owned_port()
        result = subprocess.run([str(self.bin / 'psql'), '-X', '-qAt', '-w', '-h', '127.0.0.1', '-p', str(self.port), '-U', role, '-d', role, '-c', 'SELECT 1'],
                                capture_output=True, text=True, timeout=30, env=clean_env(PGCONNECT_TIMEOUT='5', PGPASSWORD=self.secrets[role].read_text().strip()))
        if result.returncode == 0:
            return 'ok'
        return next((state for text, state in LOGIN_STATES if text in result.stderr), 'other: ' + result.stderr.strip()[-200:])

    def log_offset(self):
        return self.log.stat().st_size if self.log.exists() else 0

    def log_since(self, offset):
        with self.log.open('rb') as file:
            file.seek(offset)
            return file.read().decode(errors='replace')

    def events(self, offset):
        """The trigger functions' events since the offset: wall time, backend pid, kind, sessions, seconds, statement_timeout."""
        found = []
        for line in self.log_since(offset).splitlines():
            match = EVENT.match(line)
            if match:
                at = datetime.datetime.strptime(match[1], '%Y-%m-%d %H:%M:%S.%f').replace(tzinfo=datetime.UTC).timestamp()
                found.append(dict(wall=at, pid=int(match[2]), kind=match[3], sessions=set(filter(None, match[4].split(','))), seconds=float(match[5]),
                                  timeout=match[6]))
        return found

    def shutdown(self):
        """Stops this run's postmaster through its captured identity: fast, else immediate, else KILL. True once none of
        this run runs; False (nothing signalled, the root kept) for a postmaster.pid without a captured identity."""
        if not self.data.exists():
            return True
        self.owned_data()
        if self.pidfd is None:
            if (self.data / 'postmaster.pid').exists():
                note('cleanup: a postmaster.pid without a postmaster identity captured by this run: nothing signalled')
                return False
            return True
        for mode in ('fast', 'immediate'):
            try:
                self.stop(mode)
                return True
            except AssertionError as error:
                note(f'stop -m {mode}: {error}')
        return self.forced_stop()

    def forced_stop(self):
        """KILL through the pidfd taken at the postmaster's start; True once it is gone. Without that identity nothing is
        signalled and the caller keeps the root."""
        if self.pidfd is None:
            note('cleanup: no identity of a postmaster of this run was taken: nothing signalled')
            return False
        return not send(self.pidfd, signal.SIGKILL) or gone(self.pidfd, PG_CTL_S)

    def log_lines(self, offset):
        """(wall time, process pid, text after the prefix) of every server-log line since the offset."""
        found = []
        for line in self.log_since(offset).splitlines():
            match = LOG_LINE.match(line)
            if match:
                found.append((datetime.datetime.strptime(match[1], '%Y-%m-%d %H:%M:%S.%f').replace(tzinfo=datetime.UTC).timestamp(), int(match[2]), match[3]))
        return found

    def marker(self, offset, pid, text, after):
        """Wall time of the first line `text` (exact) the process `pid` logged at or after `after`, else None."""
        return next((at for at, line_pid, line in self.log_lines(offset) if line_pid == pid and line == text and at >= after), None)


# ---------------------------------------------------------------- service processes

class Service:
    """One service process this run started: `serve CONFIG`, its own process group, output lines with their monotonic and
    wall arrival times (ANSI stripped), a log file in the run's output directory."""
    def __init__(self, run, name, label, config, port):
        self.run, self.name, self.label, self.port = run, name, label, port
        self.config = config
        self.config_path = run.root.owned(run.root.path / 'svc' / f'{label}-{name}.json')
        self.config_path.parent.mkdir(mode=0o700, exist_ok=True)
        self.config_path.write_text(json.dumps(config))
        self.config_path.chmod(0o600)
        self.lines, self.lock, self.exited, self.code = [], threading.Lock(), None, None
        self.log = (run.out / f'case{label}-{name}.log').open('a', buffering=1)
        self.started = now()
        self.process = spawn([str(run.packages[name] / 'bin' / f'{name}-server'), 'serve', str(self.config_path)], stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=str(run.home), env=run.service_env)
        self.pid = self.process.pid
        run.processes.append(self)
        self.readers = [threading.Thread(target=self.read, args=(stream, label), daemon=True) for stream, label in ((self.process.stdout, 'out'), (self.process.stderr, 'err'))]
        for reader in self.readers:
            reader.start()
        threading.Thread(target=self.wait, daemon=True).start()

    def read(self, stream, label):
        for raw in iter(stream.readline, b''):
            text = ANSI.sub('', raw.decode(errors='replace').rstrip('\n'))
            at, wall = now(), time.time()
            with self.lock:
                self.lines.append((at, wall, label, text))
            self.log.write(f'{at - self.run.t0:9.3f} {label} {text}\n')

    def wait(self):
        self.code = self.process.wait()
        self.exited = now()

    def alive(self):
        return self.process.poll() is None

    def find(self, pattern):
        with self.lock:
            return [(at, wall, label, text, match) for at, wall, label, text in self.lines for match in [pattern.search(text)] if match]

    def ready_at(self):
        found = self.find(READY[self.name])
        return found[0][0] if found else None

    def ready_wall(self):
        found = self.find(READY[self.name])
        return found[0][1] if found else None

    def limits(self):
        return self.config['databaseLimits'] if self.name == 'chronicle' else self.config['database']['limits']

    def summary(self):
        return dict(pid=self.pid, port=self.port, aliveAtCheck=self.alive(), exitCode=self.code,
                    exitedAfterSeconds=None if self.exited is None else round(self.exited - self.started, 3))

    def stop(self):
        try:
            stop_group(self.process, STOP_GRACE_S)
        finally:
            for reader in self.readers:
                reader.join(timeout=10)
            self.log.close()


class Trio(dict):
    """The three services of one case, started at once."""
    def __init__(self, run, label, ports=None, chronicle_limits=None, chronicle_indexing=None, limits=None):
        super().__init__()
        ports = ports or {name: free_port() for name in SERVICES}
        limits = limits or {}
        configs = dict(chronicle=run.chronicle_config(ports['chronicle'], {**limits, **(chronicle_limits or {})}, chronicle_indexing or {}),
                       haystack=run.haystack_config(ports['haystack'], limits), manure=run.manure_config(ports['manure'], limits))
        for name in SERVICES:
            self[name] = Service(run, name, label, configs[name], ports[name])
        self.started = min(service.started for service in self.values())

    def wait_ready(self, deadline):
        while now() < deadline and not all(s.ready_at() is not None for s in self.values()) and any(s.alive() for s in self.values() if s.ready_at() is None):
            time.sleep(POLL_S)
        return {name: s.ready_at() for name, s in self.items()}

    def wait_exit(self, deadline):
        while now() < deadline and any(s.alive() for s in self.values()):
            time.sleep(POLL_S)

    def stop(self):
        for service in self.values():
            service.stop()


# ---------------------------------------------------------------- clients

def call(port, method, path, body=None, headers=(), timeout=30):
    """(status or exception class name, body bytes, seconds) of one request on a new connection."""
    started = now()
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    try:
        payload = None if body is None else body if isinstance(body, bytes) else json.dumps(body).encode()
        connection.request(method, path, body=payload, headers={'Connection': 'close', **({'Content-Type': 'application/json'} if payload else {}), **dict(headers)})
        response = connection.getresponse()
        return response.status, response.read(), now() - started
    except (OSError, http.client.HTTPException) as error:
        return type(error).__name__, b'', now() - started
    finally:
        connection.close()


def decoded(body):
    try:
        return json.loads(body)
    except (ValueError, TypeError):
        return None


def failure_code(value):
    """The code of a Chronicle/Haystack `Failure` body ({code, message, …}), else None."""
    return value['code'] if isinstance(value, dict) and isinstance(value.get('code'), str) and isinstance(value.get('message'), str) else None


def refused_outcome(status, code, expected='unavailable'):
    """HTTP 503 whose structured failure code is the expected one: 'unavailable'; anything else names status and code."""
    return 'unavailable' if status == 503 and code == expected else f'other:{status}:{code}'


def status_result(value):
    """A `Status` result of IngestStatus ({"Status": {"result": {"jobs": [...], "total": n}}})."""
    inner = value.get('Status', {}).get('result') if isinstance(value, dict) and isinstance(value.get('Status'), dict) else None
    return isinstance(inner, dict) and isinstance(inner.get('jobs'), list) and isinstance(inner.get('total'), int)


def manure_protocol():
    """The tree's generated Manure client protocol (stdlib only)."""
    if str(REPO / 'manure') not in sys.path:
        sys.path.insert(0, str(REPO / 'manure'))
    from manure import current_protocol
    return current_protocol


def uuid7():
    stamp, rest = int(time.time() * 1000).to_bytes(6, 'big'), os.urandom(10)
    return str(uuid.UUID(bytes=stamp + bytes([0x70 | rest[0] & 0x0f, rest[1], 0x80 | rest[2] & 0x3f]) + rest[3:10]))


class WebSocket:
    """A minimal WebSocket client: masked text frames out; text, close and ping frames in. A refused upgrade keeps its
    status and body."""
    def __init__(self, port, path, headers, timeout):
        self.socket = socket.create_connection(('127.0.0.1', port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        extra = ''.join(f'{name}: {value}\r\n' for name, value in headers)
        self.socket.sendall((f'GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n'
                             f'Sec-WebSocket-Version: 13\r\n{extra}\r\n').encode())
        head = b''
        while b'\r\n\r\n' not in head:
            chunk = self.socket.recv(1)
            if not chunk:
                raise ConnectionError('closed during the handshake')
            head += chunk
        self.status, self.body = int(head.split(b' ', 2)[1]), b''
        if self.status != 101:
            length = re.search(rb'(?im)^content-length:\s*(\d+)\s*$', head)
            self.body = self.exact(int(length[1])) if length else b''

    def exact(self, n):
        data = bytearray()
        while len(data) < n:
            chunk = self.socket.recv(n - len(data))
            if not chunk:
                raise ConnectionError('closed')
            data += chunk
        return bytes(data)

    def frame(self, opcode, payload):
        mask, length = os.urandom(4), len(payload)
        header = bytes([0x80 | opcode]) + (bytes([0x80 | length]) if length < 126 else bytes([0x80 | 126]) + length.to_bytes(2, 'big'))
        self.socket.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def receive(self):
        """('message', value) or ('close', code)."""
        message = bytearray()
        while True:
            first, second = self.exact(2)
            length = second & 0x7f
            length = int.from_bytes(self.exact(2 if length == 126 else 8), 'big') if length >= 126 else length
            payload, opcode = self.exact(length), first & 0x0f
            if opcode == 8:
                return 'close', int.from_bytes(payload[:2], 'big') if len(payload) >= 2 else None
            if opcode == 9:
                self.frame(10, payload)
                continue
            if opcode == 10:
                continue
            message += payload
            if first & 0x80:
                return 'message', json.loads(message)

    def call(self, operation):
        """('result', the result of this request's envelope) or ('close', code); server Pings are answered."""
        request = str(uuid.uuid4())
        self.frame(1, json.dumps(dict(requestId=request, operation=operation)).encode())
        while True:
            kind, value = self.receive()
            if kind == 'close':
                return 'close', value
            if 'Ping' in value['result']:
                self.frame(1, json.dumps(dict(requestId=value['requestId'], operation={'Pong': value['result']['Ping']})).encode())
            elif value['requestId'] == request:
                return 'result', value['result']

    def close(self):
        self.socket.close()


class Clients:
    """The requests that need the database, per service, against one started trio: Chronicle REST (GET /api/ingest/uploads,
    bearer), MCP (ingest_status), WS (Hello + IngestStatus); Haystack item GET; Manure ListArtifacts. Each answers an
    outcome: 'ok' only for the decoded success branch (correlated request id where the protocol has one), 'unavailable…'
    only for the decoded structured unavailability, 'other:…' for anything else. Before each request the service's port
    is checked to be held by the process this run started."""
    def __init__(self, run, trio):
        self.run, self.trio = run, trio
        status, body, _ = call(self.port('chronicle'), 'GET', '/api/versions')
        versions = decoded(body)
        assert status == 200 and isinstance(versions, dict) and isinstance(versions.get('supported'), list), f'chronicle /api/versions: {status}'
        self.versions = versions['supported']
        self.origin = f'http://127.0.0.1:{trio["chronicle"].port}'
        self.cookie = None
        self.protocol = manure_protocol()

    def port(self, name):
        service = self.trio[name]
        if not service.alive():
            raise Refused(f'{name} exited; its port is no longer this run\'s')
        owned_listener(service.port, service.pid)
        return service.port

    def chronicle_rest(self, timeout=30):
        status, body, seconds = call(self.port('chronicle'), 'GET', '/api/ingest/uploads', headers={'Authorization': f'Bearer {self.run.chronicle_ingest}'}, timeout=timeout)
        value = decoded(body)
        # Baboon encodes i64 as a decimal string, i32 as a number.
        if status == 200 and isinstance(value, dict) and set(value) == UPLOAD_LIMITS and all(re.fullmatch(r'\d+', str(value[k])) for k in UPLOAD_LIMITS):
            return 'ok', status, seconds
        return refused_outcome(status, failure_code(value)), status, seconds

    def chronicle_mcp(self, timeout=30):
        rid = random.randrange(1, 2 ** 31)
        status, body, seconds = call(self.port('chronicle'), 'POST', '/mcp', dict(jsonrpc='2.0', id=rid, method='tools/call',
                                                                               params=dict(name='ingest_status', arguments=dict(offset=0, limit=5))),
                                     headers={'Authorization': f'Bearer {self.run.chronicle_read}', 'Accept': 'application/json, text/event-stream'}, timeout=timeout)
        value = decoded(body)
        if status != 200:
            return refused_outcome(status, failure_code(value)), status, seconds
        if not (isinstance(value, dict) and value.get('jsonrpc') == '2.0' and value.get('id') == rid and isinstance(value.get('result'), dict)):
            return 'other:200:not-a-result-for-this-id', status, seconds
        result = value['result']
        texts = [block.get('text') for block in result.get('content', []) if isinstance(block, dict) and block.get('type') == 'text']
        content = decoded(texts[0]) if len(texts) == 1 else None
        if result.get('isError') is not True and status_result(content):
            return 'ok', status, seconds
        if result.get('isError') is True and failure_code(content) == 'unavailable':
            return 'unavailable:tool-error', status, seconds
        return f'other:200:tool-{failure_code(content)}', status, seconds

    def chronicle_cookie(self):
        if self.cookie is None:
            connection = http.client.HTTPConnection('127.0.0.1', self.port('chronicle'), timeout=30)
            try:
                connection.request('POST', '/api/login', body=json.dumps(dict(login='alice', password=self.run.chronicle_password)).encode(),
                                   headers={'Content-Type': 'application/json', 'Origin': self.origin})
                response = connection.getresponse()
                response.read()
                assert response.status == 200, f'chronicle login: {response.status}'
                self.cookie = next(value.split(';')[0] for name, value in response.getheaders() if name.lower() == 'set-cookie' and value.startswith('chronicle_session='))
            finally:
                connection.close()
        return self.cookie

    def chronicle_ws(self, timeout=30):
        """A new socket: Hello, then IngestStatus. Unavailable: an Error envelope with code unavailable, the retryable close
        1013 (CONTRACT.md: authentication-store failures close retryably with 1013) or HTTP 503 at the upgrade with a
        Failure body coded unavailable."""
        started, cookie = now(), self.chronicle_cookie()
        try:
            ws = WebSocket(self.port('chronicle'), '/api/ws', [('Origin', self.origin), ('Cookie', cookie)], timeout)
        except OSError as error:
            return f'other:{type(error).__name__}', None, now() - started
        try:
            if ws.status != 101:
                code = failure_code(decoded(ws.body))
                return ('unavailable:http-503' if ws.status == 503 and code == 'unavailable' else f'other:http-{ws.status}:{code}'), ws.status, now() - started
            kind, value = ws.call({'Hello': {'versions': self.versions}})
            if kind == 'result' and isinstance(value.get('Hello'), dict):
                kind, value = ws.call({'IngestStatus': {'offset': 0, 'limit': 5}})
                if kind == 'result' and status_result(value):
                    return 'ok', 101, now() - started
            if kind == 'close':
                return ('unavailable:close-1013' if value == 1013 else f'other:close-{value}'), 101, now() - started
            if failure_code(value.get('Error', {}).get('failure')) == 'unavailable':
                return 'unavailable:error', 101, now() - started
            return 'other:' + next(iter(value), '?'), 101, now() - started
        except (OSError, ValueError, KeyError) as error:
            return f'other:{type(error).__name__}', 101, now() - started
        finally:
            ws.close()

    def haystack_headers(self):
        return {'Authorization': f'Bearer {self.run.haystack_token}', 'X-Haystack-Version': '1.0.0'}

    def haystack_item(self, timeout=30):
        status, body, seconds = call(self.port('haystack'), 'POST', '/api/v1/get', dict(key=HAYSTACK_KEY, revision=None), headers=self.haystack_headers(), timeout=timeout)
        value = decoded(body)
        if status == 200 and isinstance(value, dict) and value.get('key') == HAYSTACK_KEY and isinstance(value.get('revision'), int) and value['revision'] >= 1:
            return 'ok', status, seconds
        return refused_outcome(status, failure_code(value)), status, seconds

    def ensure_item(self):
        status, _, _ = call(self.port('haystack'), 'POST', '/api/v1/get', dict(key=HAYSTACK_KEY, revision=None), headers=self.haystack_headers())
        if status == 404:
            status, body, _ = call(self.port('haystack'), 'POST', '/api/v1/put', dict(key=HAYSTACK_KEY, document=dict(json=HAYSTACK_DOCUMENT), expectedRevision=0,
                                                                                    requestId=uuid7()), headers=self.haystack_headers())
            assert status == 200, f'haystack put: {status} {body[:300]!r}'
        else:
            assert self.haystack_item()[0] == 'ok', f'haystack get: {status}'

    def manure_list(self, timeout=30):
        p, rid = self.protocol, uuid.uuid4()
        body = p.dumps(p.ClientEnvelope(rid, p.API_VERSION, p.Command_ListArtifacts(p.CatalogueQuery('', False, None, None, p.CatalogueSort.CreatedAt,
                                                                                                      p.SortDirection.Desc, 10, None, [], None, None))))
        status, answer, seconds = call(self.port('manure'), 'POST', '/api/current', body, headers={'Authorization': f'Bearer {self.run.manure_token}'}, timeout=timeout)
        value = decoded(answer)
        envelope = value if isinstance(value, dict) and isinstance(value.get('result'), dict) else None
        if status == 200 and envelope is not None and envelope.get('requestId') == str(rid) and isinstance(envelope['result'].get('Catalogue'), dict):
            return 'ok', status, seconds
        # A failure before the envelope is read (authentication, admission) carries the nil request id.
        code = envelope['result'].get('Error', {}).get('failure', {}).get('code') if envelope is not None and envelope.get('requestId') in (str(rid), NIL) else None
        return refused_outcome(status, code, 'Unavailable'), status, seconds

    def ingest(self, payload):
        """The receipt of an ingest whose requestId matches, else None."""
        status, body, _ = call(self.port('chronicle'), 'POST', '/api/ingest', payload, headers={'Authorization': f'Bearer {self.run.chronicle_ingest}'})
        receipt = decoded(body)
        if (status == 200 and isinstance(receipt, dict) and receipt.get('requestId') == payload['requestId']
                and all(re.fullmatch(UUID_TEXT, str(receipt.get(key))) for key in ('sessionId', 'jobId'))):
            return receipt
        return None

    def probes(self, name):
        return dict(chronicle=dict(rest=self.chronicle_rest, mcp=self.chronicle_mcp, ws=self.chronicle_ws), haystack=dict(item=self.haystack_item),
                    manure=dict(list=self.manure_list))[name]

    def all_ok(self):
        return {f'{name}.{kind}': probe()[0] for name in SERVICES for kind, probe in self.probes(name).items()}

    def recovered(self, names, since):
        """Polls every probe of the services until each answered ok once; {probe: seconds after `since`} within the bound."""
        recovered, deadline = {}, since + RECOVER_WITHIN_S
        wanted = [(name, kind, probe) for name in names for kind, probe in self.probes(name).items()]
        while now() < deadline and len(recovered) < len(wanted):
            for name, kind, probe in wanted:
                if f'{name}.{kind}' not in recovered and probe(timeout=max(0.5, deadline - now()))[0] == 'ok' and now() <= deadline:
                    recovered[f'{name}.{kind}'] = round(now() - since, 2)
            time.sleep(POLL_S)
        return recovered, [f'{name}.{kind}' for name, kind, _ in wanted]


# ---------------------------------------------------------------- one case's verdict

class Case:
    """Mechanics conditions (the case exercised its path) and pass conditions; the verdict is INVALID if any mechanics
    condition failed, else FAIL if any pass condition failed, else PASS (case 3: INVALID without its late mechanics:
    a correlated `job held` event and committed slow publications; case 6 on SMALL: BASELINE, a measurement)."""
    def __init__(self, run, ident, rule):
        self.run, self.ident, self.rule = run, ident, rule
        self.validity, self.checks, self.notes, self.measurements, self.after = [], [], [], {}, []
        self.started = now()
        print(f'\n## case {ident}: {rule}', flush=True)

    @staticmethod
    def show(prefix, label, detail):
        print(prefix + label + (f' :: {detail}' if detail != '' else ''), flush=True)

    def valid(self, label, condition, detail=''):
        self.validity.append(dict(label=label, ok=bool(condition), detail=detail))
        self.show('mechanics ok - ' if condition else 'mechanics NOT ok - ', label, detail)
        return condition

    def check(self, label, condition, detail=''):
        self.checks.append(dict(label=label, ok=bool(condition), detail=detail))
        self.show('ok - ' if condition else 'not ok - ', label, detail)
        return condition

    def late_valid(self, label, condition, detail=''):
        """A mechanics condition judged only when every pass condition held (spec §9 case 3: `else INVALID`)."""
        self.after.append(dict(label=label, ok=bool(condition), detail=detail))
        self.show('mechanics ok - ' if condition else 'mechanics NOT ok - ', label, detail)

    def record(self, label, detail):
        """Reported, not judged."""
        self.show('recorded - ', label, detail)
        self.measurements.setdefault('recorded', []).append(dict(label=label, detail=detail))

    def note(self, message):
        self.notes.append(message)
        note(message)

    def verdict(self, baseline=False):
        if not all(v['ok'] for v in self.validity):
            return 'INVALID'
        if baseline:
            return 'BASELINE'
        if not all(c['ok'] for c in self.checks):
            return 'FAIL'
        return 'PASS' if all(v['ok'] for v in self.after) else 'INVALID'

    def result(self, baseline=False):
        verdict = self.verdict(baseline)
        print(f'case {self.ident}: {verdict} ({now() - self.started:.0f} s)', flush=True)
        return dict(case=self.ident, rule=self.rule, verdict=verdict, seconds=round(now() - self.started, 1), validity=self.validity + self.after,
                    checks=self.checks, notes=self.notes, measurements=self.measurements)


def lines_of(service, pattern):
    return [(round(at - service.started, 3), label, text) for at, _, label, text, _ in service.find(pattern)]


def failure_lines(service):
    return lines_of(service, FAILURE)


# ---------------------------------------------------------------- the run

class Run:
    def __init__(self, set_name, out, packages, calibration):
        self.set_name, self.out, self.packages, self.calibration = set_name, out, packages, calibration
        self.t0 = now()
        self.root = Root()
        try:
            self.home = self.root.path / 'home'
            self.home.mkdir(mode=0o700)
            (self.root.path / 'tmp').mkdir(mode=0o700)
            self.service_env = dict(PATH=os.environ['PATH'], HOME=str(self.home), TMPDIR=str(self.root.path / 'tmp'), LANG='C.UTF-8')
            self.cluster = Cluster(self.root, out)
            self.processes, self.stub = [], None
            self.manure_data = self.root.path / 'manure-data'
        except BaseException:
            self.root.remove()
            raise

    # -- setup

    def secret(self, name, text):
        path = self.root.owned(self.root.path / 'secrets' / name)
        path.parent.mkdir(mode=0o700, exist_ok=True)
        path.write_text(text)
        path.chmod(0o600)
        return path

    def setup(self):
        self.cluster.init()
        note(f'cluster: PostgreSQL {self.cluster.sql("postgres", "SHOW server_version")[0][0]} on port {self.cluster.port}, data {self.cluster.data}')
        roles = self.cluster.sql('postgres', "SELECT r.rolname, r.rolconnlimit, coalesce(array_to_string(s.setconfig, ','), '') FROM pg_roles r "
                                 "LEFT JOIN pg_db_role_setting s ON s.setrole=r.oid AND s.setdatabase=(SELECT oid FROM pg_database WHERE datname=r.rolname) "
                                 "WHERE r.rolname IN ('chronicle','haystack','manure') ORDER BY 1")
        note('roles: ' + json.dumps(roles))
        self.chronicle_password = secrets.token_urlsafe(24)
        self.chronicle_ingest, self.chronicle_read = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        hashed = subprocess.run([str(self.packages['chronicle'] / 'bin/chronicle-server'), 'password-hash'], input=self.chronicle_password + '\n', text=True,
                                capture_output=True, timeout=120, env=self.service_env, cwd=str(self.home))
        assert hashed.returncode == 0 and hashed.stdout.strip(), f'chronicle password-hash: {hashed.returncode}'
        self.files = dict(password_hash=self.secret('chronicle-alice', hashed.stdout.strip() + '\n'), ingest=self.secret('chronicle-ingest', self.chronicle_ingest + '\n'),
                          read=self.secret('chronicle-read', self.chronicle_read + '\n'), empty=self.secret('model-credential', ''))
        # One identity per token for the whole run: Chronicle refuses the same token value under another id.
        self.static_tokens = [dict(id=str(uuid.uuid4()), userId='alice', name='restart-ingest', scopes=['Ingest'], tokenFile=str(self.files['ingest'])),
                              dict(id=str(uuid.uuid4()), userId='alice', name='restart-read', scopes=['Read'], tokenFile=str(self.files['read']))]
        self.haystack_token, self.manure_token = (base64.urlsafe_b64encode(os.urandom(32)).rstrip(b'=').decode() for _ in range(2))
        self.files.update(haystack_hash=self.secret('haystack-bot.sha256', hashlib.sha256(self.haystack_token.encode('ascii')).hexdigest() + '\n'),
                          manure_hash=self.secret('manure-operator.sha256', hashlib.sha256(self.manure_token.encode('utf-8')).hexdigest() + '\n'))
        self.manure_data.mkdir(mode=0o700)
        self.start_stub()

    def start_stub(self):
        """Chronicle's stub models: the STUB server of chronicle/scripts/upload-bounds.py (read from the tree, not executed)."""
        tree = ast.parse((REPO / 'chronicle/scripts/upload-bounds.py').read_text())
        code = next(ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign) and any(getattr(t, 'id', None) == 'STUB' for t in node.targets))
        stub = self.root.path / 'stub'
        stub.mkdir(mode=0o700)
        (stub / 'delay').write_text('0')
        (stub / 'shape').write_text('default')
        self.stub = spawn([sys.executable, '-c', code, str(DIMENSIONS), str(stub / 'delay'), str(stub / 'port'), str(stub / 'shape')],
                          stdin=subprocess.DEVNULL)
        deadline = now() + 30
        while not (stub / 'port').exists() or not (stub / 'port').read_text():
            assert self.stub.poll() is None and now() < deadline, 'stub model server start'
            time.sleep(0.1)
        self.stub_port = int((stub / 'port').read_text())
        owned_listener(self.stub_port, self.stub.pid)
        note(f'stub models on port {self.stub_port}')

    # -- configurations

    def jdbc(self, name):
        return f'jdbc:postgresql://127.0.0.1:{self.cluster.port}/{name}'

    def chronicle_config(self, port, limits, indexing):
        config = json.loads((REPO / 'chronicle/config.example.json').read_text())
        config.update(listenHost='127.0.0.1', listenPort=port, allowedOrigin=f'http://127.0.0.1:{port}', secureCookies=False, allowInsecureHttp=False,
                      jdbcUrl=self.jdbc('chronicle'), databaseUser='chronicle', databasePasswordFile=str(self.cluster.secrets['chronicle']),
                      databaseLimits={**LIMITS['chronicle'], **limits},
                      users=[dict(id='alice', login='alice', passwordHashFile=str(self.files['password_hash']), enabled=True)], staticTokens=self.static_tokens)
        if indexing:
            config['indexing'] = dict(annotationSessions=4, embeddingRequests=8, embeddingBatchSize=16, **indexing)  # Core.scala IndexingCapacity.defaults
        stub = f'http://127.0.0.1:{self.stub_port}'
        config['annotation'].update(endpoint=stub + '/v1/chat/completions', credentialFile=str(self.files['empty']), model='stub-annotation', revision='restart-acceptance',
                                    requestPolicy='strict-json-schema', timeoutSeconds=60, maxResponseBytes=1048576)
        config['embedding'].update(endpoint=stub + '/v1/embeddings', credentialFile=str(self.files['empty']), model='stub-embedding', revision='restart-acceptance',
                                   dimensions=DIMENSIONS, sendDimensions=False, timeoutSeconds=60, maxResponseBytes=4 * 1024 * 1024)
        return config

    def haystack_config(self, port, limits):
        config = json.loads((REPO / 'haystack/docs/scala-config.example.json').read_text())
        config.update(listenHost='127.0.0.1', listenPort=port, webRoot=None, authReloadMs=HAYSTACK_AUTH_RELOAD_MS)
        config['auth'].update(cookieSecure=False, allowedHosts=['127.0.0.1'], allowedOrigins=[f'http://127.0.0.1:{port}'], insecureHttpOrigins=[],
                              rateLimit=dict(windowMs=60000, max=GENEROUS_RATE),
                              users=[dict(id='bot', type='agent', displayName='Bot', enabled=True, tokens=[dict(id='default', hashFile=str(self.files['haystack_hash']))])])
        config['database'] = dict(jdbcUrl=self.jdbc('haystack'), user='haystack', passwordFile=str(self.cluster.secrets['haystack']), limits={**LIMITS['haystack'], **limits})
        return config

    def manure_config(self, port, limits):
        return dict(data_dir=str(self.manure_data), api_origin=f'http://127.0.0.1:{port}', listen_address='127.0.0.1', port=port, content_mode='path', content_suffix='',
                    loopback_dev=True, dashboard_dir=None, unlock_shell_dir=None, viewer_dir=None, rate_limit_per_min=GENEROUS_RATE,
                    users=[dict(id='operator', type='human', tokens=[dict(id='primary', hashFile=str(self.files['manure_hash']))])],
                    database=dict(jdbcUrl=self.jdbc('manure'), user='manure', passwordFile=str(self.cluster.secrets['manure']), limits={**LIMITS['manure'], **limits}))

    # -- teardown

    def cleanup(self):
        """Every step runs whatever an earlier one raised; the root is removed only once no postmaster of it runs."""
        steps = [(f'{getattr(p, "name", "process")} {p.pid}', p.stop) for p in reversed(self.processes)]
        if self.stub is not None:
            steps.append((f'stub {self.stub.pid}', lambda: stop_group(self.stub, KILL_WAIT_S)))
        for label, step in steps:
            try:
                step()
            except Exception as error:
                note(f'cleanup: stopping {label}: {type(error).__name__}: {error}')
        try:
            stopped = self.cluster.shutdown()
        except Exception as error:
            stopped = False
            note(f'cleanup: cluster: {type(error).__name__}: {error}')
        if stopped:
            self.root.remove()
        else:
            note(f'cleanup: a postmaster of {self.cluster.data} may still run; root kept')


def started_trio(run, case, label, **options):
    """A trio started with the database up, ready within the mechanics bound, its clients; None (case INVALID) otherwise."""
    trio = Trio(run, label, **options)
    ready = trio.wait_ready(trio.started + START_READY_S)
    if not case.valid(f'the three services start and print their ready lines within {START_READY_S} s', all(ready.values()),
                      {name: None if at is None else round(at - trio[name].started, 1) for name, at in ready.items()}):
        for name, service in trio.items():
            case.note(f'{name} failure lines: {failure_lines(service)}')
        return trio, None
    return trio, Clients(run, trio)


# ---------------------------------------------------------------- cases 1, 2b, 2, 5

def case_1(run):
    case = Case(run, '1', 'Before PostgreSQL: cluster stopped, start the three, start PostgreSQL after 10 s -> one `database-wait code=jdbc-08001` '
                          'line each, ready within 30 s of the PostgreSQL start.')
    run.cluster.stop()
    case.valid('the cluster is stopped and its port refuses connections when the services start', not run.cluster.running() and closed(run.cluster.port))
    trio = Trio(run, '1')
    try:
        sleep_until(trio.started + PG_DELAY_S)
        case.note(f'services alive at +{PG_DELAY_S} s: { {name: s.alive() for name, s in trio.items()} }')
        pg_started, offset, requested = now(), run.cluster.log_offset(), time.time()
        run.cluster.primary()
        accepting = run.cluster.marker(offset, run.cluster.postmaster, READY_TO_ACCEPT, requested - 1)
        case.valid(f'PostgreSQL started {PG_DELAY_S} s after the services, logged `ready to accept connections` and accepts logins',
                   accepting is not None and run.cluster.login_state('chronicle') == 'ok', f'the start returned after {now() - pg_started:.1f} s')
        ready = trio.wait_ready(pg_started + READY_AFTER_PG_S)
        for name, service in trio.items():
            waits = lines_of(service, WAIT)
            case.check(f'{name}: exactly one `database-wait code=jdbc-08001` line', len(waits) == 1 and WAIT.search(waits[0][2])[2] == 'jdbc-08001', waits)
            at = ready[name]
            wall = service.ready_wall()
            case.check(f'{name}: ready after PostgreSQL logged `ready to accept connections` and within {READY_AFTER_PG_S} s of the start',
                       at is not None and accepting is not None and wall > accepting and at - pg_started <= READY_AFTER_PG_S,
                       dict(readyAfterPgStartSeconds=None if at is None else round(at - pg_started, 2),
                            readyAfterAcceptingSeconds=None if wall is None or accepting is None else round(wall - accepting, 3), process=service.summary(),
                            failureLines=failure_lines(service), readyLines=lines_of(service, WAIT_READY)))
    finally:
        trio.stop()
    return case.result()


def case_2b(run):
    case = Case(run, '2b', 'During 57P03, never promoted: `startWaitMs` 10000 -> exit 1 within 10-11 s, one `stage=database-wait` line.')
    run.cluster.as_standby()
    case.valid('the standby (hot_standby=off) answers a new login with 57P03 before the services start', run.cluster.login_state('chronicle') == '57P03')
    trio = Trio(run, '2b', limits=dict(startWaitMs=SHORT_WAIT_MS))
    try:
        trio.wait_exit(trio.started + CASE_2B_OBSERVE_S)
        case.valid('the standby still answers 57P03 after the services ended', run.cluster.login_state('chronicle') == '57P03')
        for name, service in trio.items():
            elapsed = None if service.exited is None else service.exited - service.started
            case.check(f'{name}: exit 1 within {EXIT_WINDOW_S[0]:.0f}-{EXIT_WINDOW_S[1]:.0f} s of its start',
                       service.code == 1 and elapsed is not None and EXIT_WINDOW_S[0] <= elapsed <= EXIT_WINDOW_S[1], service.summary())
            waits = [line for line in failure_lines(service) if FAILURE.search(line[2])[2] == 'database-wait']
            case.check(f'{name}: exactly one `stage=database-wait` line', len(waits) == 1, dict(stageLines=waits, failureLines=failure_lines(service)))
    finally:
        trio.stop()
    return case.result()


def case_2(run):
    case = Case(run, '2', 'During 57P03: standby with `hot_standby=off`, promote after 15 s -> one `code=jdbc-57P03` line each, ready within 30 s '
                          'after promote.')
    run.cluster.as_standby()
    case.valid('the standby (hot_standby=off) answers a new login with 57P03 before the services start', run.cluster.login_state('chronicle') == '57P03')
    trio = Trio(run, '2')
    try:
        sleep_until(trio.started + PROMOTE_AFTER_S)
        case.valid(f'the standby still answers 57P03 at +{PROMOTE_AFTER_S} s', run.cluster.login_state('chronicle') == '57P03')
        case.note(f'services alive at +{PROMOTE_AFTER_S} s: { {name: s.alive() for name, s in trio.items()} }')
        promoted, offset, requested = now(), run.cluster.log_offset(), time.time()
        run.cluster.promote()
        accepting = run.cluster.marker(offset, run.cluster.postmaster, READY_TO_ACCEPT, requested - 1)
        case.valid('promoted: the postmaster logged `ready to accept connections` (recovery ended), recovery is off and logins work',
                   accepting is not None and run.cluster.sql('postgres', 'SELECT pg_is_in_recovery()')[0][0] == 'f' and run.cluster.login_state('chronicle') == 'ok',
                   f'the promotion ended after {now() - promoted:.1f} s')
        ready = trio.wait_ready(promoted + READY_AFTER_PROMOTE_S)
        for name, service in trio.items():
            waits = lines_of(service, WAIT)
            case.check(f'{name}: exactly one `database-wait code=jdbc-57P03` line', len(waits) == 1 and WAIT.search(waits[0][2])[2] == 'jdbc-57P03', waits)
            at = ready[name]
            wall = service.ready_wall()
            case.check(f'{name}: ready after recovery ended (`ready to accept connections`) and within {READY_AFTER_PROMOTE_S} s of the promotion',
                       at is not None and accepting is not None and wall > accepting and at - promoted <= READY_AFTER_PROMOTE_S,
                       dict(readyAfterPromoteSeconds=None if at is None else round(at - promoted, 2),
                            readyAfterRecoveryEndSeconds=None if wall is None or accepting is None else round(wall - accepting, 3), process=service.summary(),
                            failureLines=failure_lines(service), readyLines=lines_of(service, WAIT_READY)))
    finally:
        trio.stop()
        run.cluster.primary()
    return case.result()


def case_5(run):
    case = Case(run, '5', 'Occupied port: a listener on each port -> exit 1 within 60 s, one `stage=bind code=address-in-use ... port=<p>` line.')
    run.cluster.primary()
    held = {}
    for name in SERVICES:
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen(1)
        held[name] = listener
    ports = {name: listener.getsockname()[1] for name, listener in held.items()}
    trio = None
    try:
        trio = Trio(run, '5', ports=ports)
        trio.wait_exit(trio.started + BIND_EXIT_S)
        for name, service in trio.items():
            case.valid(f'{name}: this run\'s listener held port {ports[name]} throughout', holds_listener(ports[name], os.getpid()))
            elapsed = None if service.exited is None else service.exited - service.started
            case.check(f'{name}: exit 1 within {BIND_EXIT_S} s', service.code == 1 and elapsed is not None and elapsed <= BIND_EXIT_S, service.summary())
            failures = failure_lines(service)
            bind = re.compile(rf'^{name} failure stage=bind code=address-in-use .* port={ports[name]}$')
            case.check(f'{name}: exactly one failure line, `stage=bind code=address-in-use ... port={ports[name]}`',
                       len(failures) == 1 and bind.search(failures[0][2]) is not None, failures)
    finally:
        if trio is not None:
            trio.stop()
        for listener in held.values():
            listener.close()
    return case.result()


# ---------------------------------------------------------------- case 6

def database_stats(run):
    rows = run.cluster.sql('postgres', "SELECT datname, sessions, xact_commit + xact_rollback FROM pg_stat_database WHERE datname IN ('chronicle','haystack','manure')")
    return {row[0]: dict(sessions=int(row[1]), transactions=int(row[2])) for row in rows}


def backends(run):
    rows = run.cluster.sql('postgres', "SELECT usename, count(*) FROM pg_stat_activity WHERE usename IN ('chronicle','haystack','manure') GROUP BY 1")
    return {name: 0 for name in SERVICES} | {row[0]: int(row[1]) for row in rows}


class Sampler:
    """Calls `sample` every `period` seconds on a thread until stopped; a failed sample is recorded as its error."""
    def __init__(self, sample, period):
        self.samples, self.stopping = [], threading.Event()
        self.thread = threading.Thread(target=self.loop, args=(sample, period), daemon=True)
        self.thread.start()

    def loop(self, sample, period):
        while not self.stopping.is_set():
            started = now()
            try:
                value = sample()
            except Exception as error:
                value = dict(error=type(error).__name__)
            self.samples.append((started, value))
            self.stopping.wait(max(0.0, period - (now() - started)))

    def stop(self):
        self.stopping.set()
        self.thread.join(timeout=SQL_S + 10)
        return self.samples


def requests_run(clients):
    """1,000 database requests per service (WORKLOAD), the three services concurrently, each sequentially on its own
    thread: outcome counts and wall time per service."""
    work = dict(chronicle=clients.chronicle_mcp, haystack=clients.haystack_item, manure=clients.manure_list)
    results = {}

    def one(name):
        started, outcomes = now(), {}
        for _ in range(REQUESTS):
            if now() > started + REQUEST_RUN_S:
                break
            try:
                outcome = work[name]()[0]
            except Refused as refused:
                outcome = f'refused:{refused}'
            outcomes[outcome] = outcomes.get(outcome, 0) + 1
        results[name] = dict(outcomes=outcomes, seconds=round(now() - started, 1))
    threads = [threading.Thread(target=one, args=(name,), daemon=True) for name in SERVICES]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=REQUEST_RUN_S + 60)
    return results


def snapshot(run, label):
    """Raw counters at one instant: pg_stat_database per service database and TIME_WAIT to/from the cluster port."""
    return dict(label=label, t=now(), wall=time.time(), databases=database_stats(run), timeWait=time_wait(run.cluster.port))


def delta(later, earlier, name, key='sessions'):
    return later['databases'][name][key] - earlier['databases'][name][key]


def load_calibration(path):
    """T of a SMALL run's case 6 (background-corrected request sessions per run kind and service) — only a BASELINE of the
    same WORKLOAD with positive values."""
    report = json.loads(Path(path).read_text())
    assert report.get('set') == 'SMALL', 'not a SMALL run'
    six = next(case for case in report['cases'] if case['case'] == '6')
    assert six['verdict'] == 'BASELINE', f'its case 6 is {six["verdict"]}'
    measured = six['measurements']
    assert measured['workload'] == WORKLOAD, 'another workload'
    calibration = {phase: {name: measured['derived'][phase][name]['requestSessions'] for name in SERVICES} for phase in ('cold', 'warm')}
    assert all(value > 0 for phases in calibration.values() for value in phases.values()), f'non-positive T: {calibration}'
    return calibration


def case_6(run):
    case = Case(run, '6', 'Connections per 1,000 transactions (SMALL baseline, POOL): workers idle; 1,000 requests per service (Chronicle MCP '
                          '`ingest_status`, Haystack item GET, Manure list); cold and warm runs; sessions x 1000 / T and TIME_WAIT to the PostgreSQL '
                          'port. POOL pass: warm delta 0, cold <= P (10/6/6), backends per role <= P at every 1 s sample, no 53300.')
    run.cluster.primary()
    offset = run.cluster.log_offset()
    sampler = Sampler(lambda: backends(run), BACKEND_SAMPLE_S)
    snapshots, trio = [], None
    try:
        time.sleep(PGSTAT_FLUSH_S)
        snapshots.append(snapshot(run, 'beforeStart'))
        trio, clients = started_trio(run, case, '6')
        if clients is None:
            return case.result()
        clients.ensure_item()
        busy = run.cluster.sql('chronicle', "SELECT count(*) FROM ch_jobs WHERE state IN ('Queued','Running')")[0][0]
        case.valid('workers idle: no Chronicle job Queued or Running', busy == '0', busy)
        time.sleep(PGSTAT_FLUSH_S)
        snapshots.append(snapshot(run, 'ready'))
        time.sleep(IDLE_S)
        snapshots.append(snapshot(run, 'idle'))
        runs = {}
        for phase in ('cold', 'warm'):
            answered = requests_run(clients)
            peak = time_wait(run.cluster.port)
            time.sleep(PGSTAT_FLUSH_S)
            snapshots.append(snapshot(run, phase) | dict(timeWaitRightAfterRequests=peak))
            runs[phase] = answered
    finally:
        samples = sampler.stop()
        if trio is not None:
            trio.stop()
    start, ready, idle, cold, warm = snapshots
    rate = {name: delta(idle, ready, name) / (idle['t'] - ready['t']) for name in SERVICES}
    derived = dict(startup={name: dict(sessions=delta(ready, start, name), transactions=delta(ready, start, name, 'transactions')) for name in SERVICES},
                   backgroundSessionsPerSecond={name: round(rate[name], 3) for name in SERVICES},
                   coldFromStart={name: delta(cold, start, name) for name in SERVICES})
    calibration = run.calibration or {}
    for phase, before, after in (('cold', idle, cold), ('warm', cold, warm)):
        derived[phase] = {}
        for name in SERVICES:
            sessions = delta(after, before, name)
            background = rate[name] * (after['t'] - before['t'])
            row = dict(sessions=sessions, transactions=delta(after, before, name, 'transactions'), backgroundSessions=round(background, 1),
                       requestSessions=round(sessions - background, 1), **runs[phase].get(name, dict(outcomes={}, seconds=None)))
            denominator = calibration.get(phase, {}).get(name) if run.set_name == 'POOL' else row['requestSessions']
            row['calibratedTransactions'] = denominator
            row['sessionsPer1000Transactions'] = round(row['requestSessions'] * 1000 / denominator, 1) if denominator and denominator > 0 else None
            derived[phase][name] = row
            case.valid(f'{phase}: {name} answered all {REQUESTS} requests with its decoded success', row['outcomes'] == {'ok': REQUESTS}, row['outcomes'])
    server_log = run.cluster.log_since(offset)
    peaks = {name: max((value.get(name, 0) for _, value in samples if 'error' not in value), default=None) for name in SERVICES}
    rejected = TOO_MANY.findall(server_log) + [text for service in (trio or {}).values() for _, _, _, text, _ in service.find(re.compile('53300'))]
    raw = [dict(label=s['label'], secondsAfterCaseStart=round(s['t'] - start['t'], 1), wall=round(s['wall'], 3), databases=s['databases'], timeWait=s['timeWait'],
                **({'timeWaitRightAfterRequests': s['timeWaitRightAfterRequests']} if 'timeWaitRightAfterRequests' in s else {})) for s in snapshots]
    case.measurements = dict(workload=WORKLOAD, snapshots=raw, derived=derived, backendsPeak=peaks, backendSamples=len(samples),
                             sampleErrors=sum(1 for _, v in samples if 'error' in v), rejections53300=rejected[:20],
                             calibrationSource=os.environ.get('RESTART_ACC_CALIBRATION') if run.set_name == 'POOL' else 'this run (T = its own background-corrected sessions)')
    case.valid(f'backends sampled every {BACKEND_SAMPLE_S} s from before the start, without error', samples and not any('error' in v for _, v in samples), len(samples))
    case.valid('background measured over the idle window', idle['t'] - ready['t'] >= IDLE_S, round(idle['t'] - ready['t'], 1))
    note('case 6 measurements: ' + json.dumps(dict(derived=derived, timeWait=[(s['label'], s['timeWait']) for s in raw], backendsPeak=peaks)))
    if run.set_name == 'POOL':
        for name in SERVICES:
            warm_delta = delta(warm, cold, name)
            case.check(f'{name}: warm sessions delta 0', warm_delta == 0, warm_delta)
            case.check(f'{name}: cold sessions (from before the start through the cold run) <= P + {START_PROBES} (R-b start probe) = {POOL_SIZE[name] + START_PROBES}',
                       derived['coldFromStart'][name] <= POOL_SIZE[name] + START_PROBES,
                       dict(coldFromStart=derived['coldFromStart'][name], startup=derived['startup'][name]['sessions'], coldRun=derived['cold'][name]['sessions']))
            case.check(f'{name}: backends of its role <= P = {POOL_SIZE[name]} at every sample', peaks[name] is not None and peaks[name] <= POOL_SIZE[name], peaks[name])
        case.check('no 53300 (server log, service output)', not rejected, rejected[:5])
    return case.result(baseline=run.set_name != 'POOL')


# ---------------------------------------------------------------- case 4

LATCHED_PROBE = dict(chronicle='rest', haystack='item', manure='list')


class Latch:
    """A superuser transaction of this run holding ACCESS EXCLUSIVE on every table of one service database, so that the
    service's next transaction waits on a lock: a live backend of its role to terminate (case 4)."""
    def __init__(self, run, database):
        self.run, self.name = run, f'restart-acc-latch-{database}'
        tables = [row[0] for row in run.cluster.sql(database, "SELECT format('%I.%I', schemaname, tablename) FROM pg_tables "
                                                              "WHERE schemaname NOT IN ('pg_catalog', 'information_schema')")]
        assert tables, f'{database} has no tables to latch'
        run.cluster.owned_data()
        self.process = spawn([*run.cluster.psql(database)], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True,
                             env=clean_env(PGCONNECT_TIMEOUT='5', PGAPPNAME=self.name))
        self.pid = self.process.pid
        run.processes.append(self)
        self.process.stdin.write(f"SET lock_timeout = '{LATCH_S}s';\nBEGIN;\nLOCK TABLE {', '.join(tables)} IN ACCESS EXCLUSIVE MODE;\n")
        self.process.stdin.flush()
        deadline = now() + LATCH_S + 5
        while self.granted() < len(tables):
            assert self.process.poll() is None and now() < deadline, f'latch on {database} not granted'
            time.sleep(POLL_S)

    def granted(self):
        return int(self.run.cluster.sql('postgres', "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE l.granted "
                                                    f"AND l.mode = 'AccessExclusiveLock' AND l.locktype = 'relation' AND a.application_name = '{self.name}'")[0][0])

    def stop(self):
        """ROLLBACK and quit; if psql does not end, its backend is terminated and its group stopped."""
        if self.process.poll() is None:
            try:
                self.process.stdin.write('ROLLBACK;\n\\q\n')
                self.process.stdin.close()
                self.process.wait(timeout=KILL_WAIT_S)
            except (OSError, subprocess.TimeoutExpired):
                self.run.cluster.sql('postgres', f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = '{self.name}'")
                stop_group(self.process, KILL_WAIT_S)


class Inflight:
    """One probe on its own thread (it waits on the latch's lock); its outcome once it returned."""
    def __init__(self, probe):
        self.result = None
        self.thread = threading.Thread(target=self.run, args=(probe,), daemon=True)
        self.thread.start()

    def run(self, probe):
        try:
            self.result = probe(timeout=INFLIGHT_S)
        except Refused as refused:
            self.result = (f'refused:{refused}', None, None)

    def join(self):
        self.thread.join(timeout=INFLIGHT_S + 5)
        return None if self.result is None else dict(outcome=self.result[0], status=self.result[1], seconds=None if self.result[2] is None else round(self.result[2], 3))


def backends_of(run, roles):
    names = ','.join(f"'{role}'" for role in roles)
    return {int(pid): dict(role=role, wait=wait) for pid, role, wait in
            run.cluster.sql('postgres', f"SELECT pid, usename, coalesce(wait_event_type, '') FROM pg_stat_activity WHERE usename IN ({names})")}


def terminate(run, pids):
    """{pid: whether pg_terminate_backend ended it within TERMINATE_WAIT_MS} (it returns false for a backend already gone)."""
    if not pids:
        return {}
    listed = ','.join(str(pid) for pid in pids)
    return {int(pid): ok == 't' for pid, ok in
            run.cluster.sql('postgres', f'SELECT pid, pg_terminate_backend(pid, {TERMINATE_WAIT_MS}) FROM unnest(ARRAY[{listed}]::int[]) AS pid')}


def vanished(run, pids):
    deadline, listed = now() + VANISH_S, ','.join(str(pid) for pid in pids) or '0'
    while now() < deadline:
        if run.cluster.sql('postgres', f'SELECT count(*) FROM pg_stat_activity WHERE pid IN ({listed})')[0][0] == '0':
            return True
        time.sleep(POLL_S)
    return False


def terminate_latched(run, case, clients, roles, label, fence=None):
    """Latches every role's database, fires one of its service's probes (it waits on the lock: a live backend of the role),
    optionally fences (`fence()`: NOLOGIN), terminates the roles' backends (with a fence: repeatedly until none remains,
    spec §10), verifies the targets vanished, releases the latches. Mechanics: a latched backend per role, terminated by
    pg_terminate_backend; all targets gone; with a fence zero remain. Returns the instant termination was verified."""
    latches, inflight = [], {}
    try:
        for role in roles:
            latches.append(Latch(run, role))
        inflight = {role: Inflight(clients.probes(role)[LATCHED_PROBE[role]]) for role in roles}
        waiting, deadline = {}, now() + LATCH_S
        while now() < deadline:
            waiting = {role: {pid for pid, b in backends_of(run, (role,)).items() if b['wait'] == 'Lock'} for role in roles}
            if all(waiting.values()):
                break
            time.sleep(POLL_S)
        case.valid(f'{label}: a backend of each role waits on the latch (a live session to terminate)', all(waiting.get(role) for role in roles),
                   {role: sorted(pids) for role, pids in waiting.items()})
        if fence is not None:
            fence()
        targets, results, rounds, deadline = {}, {}, 0, now() + ZERO_SESSIONS_S
        while True:
            current = backends_of(run, roles)
            if rounds and (fence is None or not current or now() > deadline):
                break
            targets.update(current)
            results.update(terminate(run, list(current)))
            rounds += 1
            if fence is not None:
                time.sleep(POLL_S)
        remaining = len(backends_of(run, roles))
        latched_ok = all(results.get(pid) for pids in waiting.values() for pid in pids)
        case.valid(f'{label}: every latched backend ended by pg_terminate_backend', latched_ok and any(waiting.values()),
                   dict(targets={pid: dict(role=b['role'], wait=b['wait'], terminated=results.get(pid)) for pid, b in targets.items()}, rounds=rounds))
        case.valid(f'{label}: every terminated backend is gone from pg_stat_activity', vanished(run, list(targets)), sorted(targets))
        if fence is not None:
            case.valid(f'{label}: no session of the role remains (verified after {rounds} round(s))', remaining == 0, remaining)
        return now()
    finally:
        for latch in latches:
            latch.stop()
        answers = {role: flight.join() for role, flight in inflight.items()}
        if answers:
            case.record(f'{label}: answers of the probes that waited on the latch', answers)


def case_4(run):
    pool = run.set_name == 'POOL'
    case = Case(run, '4', 'Terminate, fence, unfence: terminate all three roles\' sessions; then per role the §10 fence procedure for 30 s, then '
                          '`LOGIN` -> while fenced: REST/HTTP 503 (Chronicle REST, Haystack, Manure), Chronicle WS `unavailable`, MCP tool error '
                          '`unavailable` (or bearer phase 503), each within queueTimeout + connectTimeout + 1 s; 200 within 15 s after `LOGIN`; PIDs '
                          'unchanged. [review r1: termination, fencing and recovery without a restart on SMALL and POOL; the fenced response '
                          f'contract on POOL only; this run: {run.set_name}]')
    run.cluster.primary()
    trio, clients = started_trio(run, case, '4')
    try:
        if clients is None:
            return case.result()
        clients.ensure_item()
        pids = {name: s.pid for name, s in trio.items()}
        healthy = clients.all_ok()
        case.valid('every probe answers ok before the terminations', all(v == 'ok' for v in healthy.values()), healthy)
        terminated = terminate_latched(run, case, clients, SERVICES, 'all three roles')
        recovered, wanted = clients.recovered(SERVICES, terminated)
        case.check(f'after the terminations every probe answers ok within {RECOVER_WITHIN_S} s (no restart)', len(recovered) == len(wanted), recovered)
        for role in SERVICES:
            limits = trio[role].limits()
            bound = (limits['queueTimeoutMs'] + limits['connectTimeoutMs']) / 1000 + ANSWER_MARGIN_S
            fenced = {}

            def nologin():
                run.cluster.sql('postgres', f'ALTER ROLE "{role}" NOLOGIN')
                assert run.cluster.sql('postgres', f"SELECT rolcanlogin FROM pg_roles WHERE rolname = '{role}'")[0][0] == 'f', 'NOLOGIN not committed'
                fenced['at'] = now()  # the 30 s run from the confirmed commit
            terminate_latched(run, case, clients, (role,), f'{role} fence', fence=nologin)
            case.valid(f'{role}: a new login is refused with 28000', run.cluster.login_state(role) == '28000')
            answers = []
            while now() < fenced['at'] + FENCE_S:
                for kind, probe in clients.probes(role).items():
                    outcome, status, seconds = probe(timeout=bound + 30)
                    answers.append(dict(probe=kind, atSeconds=round(now() - fenced['at'], 2), outcome=outcome, status=status, seconds=round(seconds, 3)))
                time.sleep(PROBE_PERIOD_S)
            sleep_until(fenced['at'] + FENCE_S)
            unfenced = now()
            run.cluster.sql('postgres', f'ALTER ROLE "{role}" LOGIN')
            case.valid(f'{role}: answers were collected while fenced', len(answers) >= len(clients.probes(role)), len(answers))
            for kind in clients.probes(role):
                mine = [a for a in answers if a['probe'] == kind]
                wrong = [a for a in mine if not a['outcome'].startswith('unavailable') or a['seconds'] > bound]
                summary = dict(answers=len(mine), outcomes=sorted({a['outcome'] for a in mine}), slowest=max((a['seconds'] for a in mine), default=None),
                               boundSeconds=bound, firstOther=wrong[:3])
                if pool:
                    case.check(f'{role} fenced: every {kind} answer is unavailable within {bound:.0f} s', mine and not wrong, summary)
                else:
                    case.record(f'{role} fenced: {kind} answers (SMALL: recorded, the contract is POOL-only)', summary)
            recovered, wanted = clients.recovered((role,), unfenced)
            case.check(f'{role}: every probe of the service answers ok within {RECOVER_WITHIN_S} s after LOGIN (no restart)', len(recovered) == len(wanted), recovered)
        case.check('PIDs unchanged: the three processes started for the case are still running',
                   all(s.alive() and s.pid == pids[name] for name, s in trio.items()), {name: s.summary() for name, s in trio.items()})
        return case.result()
    finally:
        try:
            for role in SERVICES:
                run.cluster.sql('postgres', f'ALTER ROLE "{role}" LOGIN')
        finally:
            trio.stop()


# ---------------------------------------------------------------- case 3

def seconds_text(milliseconds):
    """PostgreSQL's display of a statement_timeout set in milliseconds."""
    return f'{milliseconds // 1000}s' if milliseconds % 1000 == 0 else f'{milliseconds}ms'


SLOW_SEARCH_ROWS = f'''
CREATE TABLE IF NOT EXISTS restart_acc_control(seconds double precision NOT NULL);
INSERT INTO restart_acc_control SELECT {TRIGGER_S} WHERE NOT EXISTS (SELECT FROM restart_acc_control);
CREATE OR REPLACE FUNCTION restart_acc_slow_search_rows() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET log_min_messages = 'log' AS $$
DECLARE sessions text; pause double precision; timeout text;
BEGIN
  SELECT coalesce(string_agg(DISTINCT session_id::text, ','), '') INTO sessions FROM inserted;
  IF sessions = '' THEN
    RETURN NULL;  -- a statement inserting no row (Chronicle's start-up backfill in 002.sql) is not a publication
  END IF;
  SELECT seconds INTO pause FROM restart_acc_control;
  timeout := current_setting('statement_timeout');
  RAISE LOG 'restart-acc start sessions=% seconds=% statement_timeout=%', sessions, pause, timeout;
  BEGIN
    PERFORM pg_sleep(pause);
  EXCEPTION WHEN query_canceled THEN
    RAISE LOG 'restart-acc cancelled sessions=% seconds=% statement_timeout=%', sessions, pause, timeout;
    RAISE;
  END;
  RAISE LOG 'restart-acc done sessions=% seconds=% statement_timeout=%', sessions, pause, timeout;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS restart_acc_slow_search_rows ON ch_search_chunks;
CREATE TRIGGER restart_acc_slow_search_rows AFTER INSERT ON ch_search_chunks REFERENCING NEW TABLE AS inserted
  FOR EACH STATEMENT EXECUTE FUNCTION restart_acc_slow_search_rows();
CREATE OR REPLACE FUNCTION restart_acc_request_timeout() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET log_min_messages = 'log' AS $$
BEGIN
  RAISE LOG 'restart-acc request sessions=% seconds=0 statement_timeout=%',
    (SELECT coalesce(string_agg(DISTINCT session_id::text, ','), '') FROM inserted), current_setting('statement_timeout');
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS restart_acc_request_timeout ON ch_revisions;
CREATE TRIGGER restart_acc_request_timeout AFTER INSERT ON ch_revisions REFERENCING NEW TABLE AS inserted
  FOR EACH STATEMENT EXECUTE FUNCTION restart_acc_request_timeout()'''


def session_payload(index, tag, rng):
    """A synthetic Pi session (chronicle/eval/relevance/bridge.py's ingest shape): words from a fixed vocabulary."""
    words = ['alpha', 'basalt', 'cobalt', 'delta', 'ember', 'fjord', 'granite', 'harbor', 'iris', 'juniper', 'kelp', 'lumen', 'meadow', 'nimbus', 'onyx', 'prairie']
    messages = [dict(id=f'm{i:04d}', text=f'Synthetic restart session {index} message {i}. ' + ' '.join(rng.choice(words) for _ in range(60)), parentId=None,
                     role='user', timestamp=None, recordIndex=i) for i in range(12)]
    raw = ''.join(json.dumps(m) + '\n' for m in messages)
    digest = hashlib.sha256(raw.encode()).hexdigest()
    return dict(requestId=str(uuid.uuid4()), source=dict(collectorNamespace='restart-acceptance', discoveryRootId='synthetic', format='Pi',
                                                        producerSessionId=f'{tag}-{index:02d}', subagentId=None),
                expectedRevision=0, digest=digest, completion='Closed', redacted=False,
                metadata=dict(title=f'restart session {index}', project='restart-acceptance', workdir=None, gitRemote=None, gitBranch=None, gitCommit=None,
                              producer='synthetic', model=None, startedAt='2026-01-01T00:00:00Z', endedAt=None, tags=['synthetic']),
                messages=messages, files=[dict(path='synthetic.jsonl', sha256=digest, content=raw)])


def state_count(states, state):
    """Jobs in `state` whatever their error text (job_states keys are `State` or `State:error`)."""
    return sum(count for key, count in states.items() if key.split(':', 1)[0] == state)


def job_states(run, jobs):
    ids = ','.join(f"'{job}'" for job in jobs)
    rows = run.cluster.sql('chronicle', f"SELECT state, coalesce(error, ''), count(*) FROM ch_jobs WHERE id IN ({ids}) GROUP BY 1, 2")
    return {f'{state}:{error}' if error else state: int(count) for state, error, count in rows}


def case3_sample(run, jobs):
    row = run.cluster.sql('chronicle', "SELECT (SELECT seconds FROM restart_acc_control), "
                                       "(SELECT count(*) FROM pg_stat_activity WHERE usename='chronicle' AND wait_event='PgSleep')")[0]
    return dict(postmaster=run.cluster.pid(), triggerSeconds=float(row[0]), sleeping=int(row[1]), jobs=job_states(run, jobs))


def cohort_in_progress(run, offset, cohort, seconds):
    """Cohort publications sleeping in the trigger now: a chronicle backend in PgSleep whose latest trigger event is the
    start of a statement for a cohort session at the current sleep (`seconds`)."""
    sleeping = {int(row[0]) for row in run.cluster.sql('chronicle', "SELECT pid FROM pg_stat_activity WHERE usename='chronicle' AND wait_event='PgSleep'")}
    latest = {}
    for event in run.cluster.events(offset):
        if event['kind'] != 'request':
            latest[event['pid']] = event
    return [dict(pid=pid, sessions=sorted(latest[pid]['sessions'] & cohort), sinceWall=latest[pid]['wall']) for pid in sorted(sleeping)
            if pid in latest and latest[pid]['kind'] == 'start' and latest[pid]['sessions'] & cohort and latest[pid]['seconds'] == seconds]


def interrupted_by(run, offset, sampled, postmaster, mode, after, until):
    """The sampled publications this restart interrupted, judged on the server log against the old postmaster's own
    shutdown marker (`received <mode> shutdown request`): from its `start` event to the marker the backend logged no
    cancellation, completion, ERROR or FATAL and the postmaster reported no exit of it (an unexplained exit, e.g. an OOM
    kill, disqualifies it); after the marker a fast shutdown's FATAL from it explains its end (an immediate shutdown logs
    none); a cancellation or completion of the statement at any time up to the end of the restart (`until`) disqualifies it
    (it ended before the signal reached it). (marker wall time or None, interrupted publications)."""
    marker = run.cluster.marker(offset, postmaster, SHUTDOWN_REQUEST[mode], after)
    if marker is None:
        return None, []
    events, lines = run.cluster.events(offset), run.cluster.log_lines(offset)
    found = []
    for publication in sampled:
        pid, since = publication['pid'], publication['sinceWall']
        ended = [e['kind'] for e in events if e['pid'] == pid and e['kind'] in ('cancelled', 'done') and since <= e['wall'] <= until]
        exits = [text for at, line_pid, text in lines if since <= at <= marker and ((line_pid == pid and text.startswith(('FATAL:', 'ERROR:')))
                                                                                     or (line_pid == postmaster and f'(PID {pid})' in text))]
        explained = mode == 'immediate' or any(line_pid == pid and text == SHUTDOWN_FATAL and at >= marker for at, line_pid, text in lines)
        if not ended and not exits and explained:
            found.append(dict(pid=pid, sessions=publication['sessions'], sinceWall=round(since, 3)))
    return marker, found


def strict_holds(service, job_sessions):
    """`job held` lines parsed in full (every field, nextAttemptAt an ISO-8601 instant) for a cohort job: (wall, fields)."""
    found = []
    for _, wall, _, text, match in service.find(HELD):
        try:
            datetime.datetime.fromisoformat(match[6])
        except ValueError:
            continue
        if match[1] in job_sessions:
            found.append(dict(wall=wall, jobId=match[1], session=job_sessions[match[1]], sqlState=match[2], errorClass=match[3], stage=match[4],
                              consecutive=int(match[5]), nextAttemptAt=match[6], line=text))
    return found


class Cohort:
    """Case 3's workload: the three services (Chronicle with request statement timeout 2 s and publication timeout 10 s), the
    triggers at 3 s, 20 synthetic sessions ingested; the cohort = their jobs (this run's receipts). Mechanics: the
    services start, 20 receipts, every cohort ingest ran with the request timeout."""
    def __init__(self, run, case, label):
        self.run, self.case, self.label = run, case, label
        self.sampler, self.timeline, self.request_timeout = None, None, seconds_text(REQUEST_STATEMENT_MS)
        self.publication_timeout = seconds_text(PUBLICATION_STATEMENT_MS)
        run.cluster.primary()
        self.trio, self.clients = started_trio(run, case, label, chronicle_limits=dict(statementTimeoutMs=REQUEST_STATEMENT_MS),
                                               chronicle_indexing=dict(publicationStatementTimeoutMs=PUBLICATION_STATEMENT_MS))
        self.ready = False
        if self.clients is None:
            return
        self.clients.ensure_item()
        self.pids = {name: s.pid for name, s in self.trio.items()}
        self.offset = run.cluster.log_offset()
        run.cluster.sql('chronicle', SLOW_SEARCH_ROWS + f';\nUPDATE restart_acc_control SET seconds = {TRIGGER_S}')
        self.rng, self.tag = random.Random(20261123), f'restart-{label}-{run.root.nonce[:8]}'
        receipts = [self.clients.ingest(session_payload(index, self.tag, self.rng)) for index in range(SESSIONS)]
        self.job_sessions = {r['jobId']: r['sessionId'] for r in receipts if r is not None}
        self.cohort, self.jobs = set(self.job_sessions.values()), list(self.job_sessions)
        if not case.valid(f'{SESSIONS} synthetic sessions ingested (receipts for these requests), one job each', len(self.cohort) == SESSIONS, len(self.cohort)):
            return
        requests = [e for e in run.cluster.events(self.offset) if e['kind'] == 'request' and e['sessions'] & self.cohort]
        case.valid(f'the request path ran with statement_timeout {self.request_timeout}: every cohort ingest\'s revision insert',
                   len({s for e in requests for s in e['sessions'] & self.cohort}) == SESSIONS and all(e['timeout'] == self.request_timeout for e in requests),
                   sorted({e['timeout'] for e in requests}))
        self.timeline = (run.out / f'case{label}-timeline.jsonl').open('a', buffering=1)
        self.sampler = Sampler(lambda: case3_sample(run, self.jobs), SAMPLE_S)
        self.ready = True

    def first_publication(self, after=0.0):
        """Mechanics: a cohort publication reaches the trigger (started at or after the wall time `after`) within the bound."""
        first, deadline = None, now() + FIRST_PUBLICATION_S
        while now() < deadline and first is None:
            first = next((e for e in self.run.cluster.events(self.offset) if e['kind'] == 'start' and e['sessions'] & self.cohort and e['wall'] >= after), None)
            time.sleep(POLL_S)
        return self.case.valid(f'a cohort publication reached the trigger within {FIRST_PUBLICATION_S} s' + (' after the restart' if after else ''), first is not None,
                               None if first is None else dict(sessions=sorted(first['sessions']), seconds=first['seconds'], statementTimeout=first['timeout']))

    def restart(self, mode, earliest, latest, origin):
        """One restart in its slot [origin + earliest, origin + latest]: at the first instant a cohort publication sleeps in the
        trigger, at the slot's end otherwise; the stop and the start through the captured postmaster identity. Returns the
        restart's record: sampled and interrupted publications (`interrupted_by`), markers, the sampled leases."""
        run = self.run
        sleep_until(origin + earliest)
        seconds_set = float(run.cluster.sql('chronicle', 'SELECT seconds FROM restart_acc_control')[0][0])
        while True:
            progress = cohort_in_progress(run, self.offset, self.cohort, seconds_set)
            if progress or now() >= origin + latest:
                break
            time.sleep(RESTART_POLL_S)
        failed_before = state_count(job_states(run, self.jobs), 'Failed')
        leases = {job: float(until) for job, until in run.cluster.sql('chronicle', 'SELECT id, extract(epoch FROM lease_until) FROM ch_jobs WHERE id IN ('
                                                                     + ','.join(f"'{j}'" for j in self.jobs) + ") AND state = 'Running' AND lease_until IS NOT NULL")}
        postmaster, started, started_wall = run.cluster.postmaster, now(), time.time()
        run.cluster.restart(mode)
        marker, interrupted = interrupted_by(run, self.offset, progress, postmaster, mode, started_wall - 1, time.time())
        ready = run.cluster.marker(self.offset, run.cluster.postmaster, READY_TO_ACCEPT, started_wall - 1)
        record = dict(mode=mode, atSeconds=round(started - origin, 1), endSeconds=round(now() - origin, 1), triggerSeconds=seconds_set,
                      postmasterBefore=postmaster, postmasterAfter=run.cluster.postmaster, shutdownMarker=marker, readyMarker=ready,
                      outageSeconds=None if marker is None or ready is None else round(ready - marker, 3), cohortInProgress=progress,
                      interrupted=interrupted, cohortFailedBefore=failed_before, leases=leases)
        self.case.note(f'restart -m {mode}: {json.dumps({k: v for k, v in record.items() if k != "leases"})}')
        return record

    def replaced(self, record, window_end=None):
        """Mechanics of one restart: its shutdown request and the new postmaster's readiness logged, the postmaster replaced
        (and, with a window, inside it at the window's sleep)."""
        inside = window_end is None or (record['triggerSeconds'] == WINDOW_TRIGGER_S and 0 <= record['atSeconds'] and record['endSeconds'] <= window_end)
        self.case.valid(f'restart -m {record["mode"]}: the old postmaster logged the shutdown request, a new one readiness'
                        + (f' (inside the fault window, trigger {WINDOW_TRIGGER_S} s)' if window_end is not None else ''),
                        inside and record['shutdownMarker'] is not None and record['readyMarker'] is not None
                        and record['postmasterAfter'] not in (None, record['postmasterBefore']),
                        {k: record[k] for k in ('atSeconds', 'endSeconds', 'triggerSeconds', 'postmasterBefore', 'postmasterAfter', 'outageSeconds')})

    def interrupted(self, record):
        """Mechanics: the restart interrupted a sampled cohort publication, unless a proven cohort failure already makes
        PASS impossible (accepted in review r2)."""
        self.case.valid(f'restart -m {record["mode"]} interrupted a sampled cohort publication (alive in the trigger until the old postmaster\'s shutdown '
                        'request, no other end logged; or a cohort job had already Failed)', record['interrupted'] or record['cohortFailedBefore'] > 0,
                        dict(interrupted=record['interrupted'], sampled=[dict(pid=p['pid'], sessions=p['sessions']) for p in record['cohortInProgress']],
                             cohortFailedBefore=record['cohortFailedBefore']))

    def settle(self, since, charged, exempt=frozenset()):
        """Pass conditions after the faults: no cohort job Failed; all Complete within the bound after `since`; (`charged`)
        every cohort job's attempts = 1 (its one completing claim: nothing charged for the transient class); every cohort
        publication statement ran with the publication timeout; PIDs unchanged; the three answer ok; a new ingest still
        runs with the request timeout. Late mechanics: every Complete job published through the 3 s trigger. Returns
        (final states, events)."""
        run, case, clients = self.run, self.case, self.clients
        final, deadline = None, since + COMPLETE_WITHIN_S
        while True:
            final = job_states(run, self.jobs)
            if state_count(final, 'Complete') + state_count(final, 'Failed') == SESSIONS or now() >= deadline or not self.trio['chronicle'].alive():
                break
            time.sleep(JOB_POLL_S)
        settled = now()
        case.check(f'0 Failed of the {SESSIONS}', state_count(final, 'Failed') == 0, final)
        case.check(f'all {SESSIONS} Complete within {COMPLETE_WITHIN_S // 60} min after the last restart',
                   state_count(final, 'Complete') == SESSIONS and settled <= deadline, dict(states=final, secondsAfterLastRestart=round(settled - since, 1)))
        attempts = {job: int(count) for job, count in run.cluster.sql('chronicle', 'SELECT id, attempts FROM ch_jobs WHERE id IN ('
                                                                        + ','.join(f"'{j}'" for j in self.jobs) + ')')}
        if charged:
            judged = {job: count for job, count in attempts.items() if job not in exempt}
            case.check('0 attempts charged: every cohort job\'s attempts = 1 (its completing claim)'
                       + (f'; {len(exempt)} job(s) out of the guarantee\'s scope exempt' if exempt else ''),
                       len(attempts) == SESSIONS and set(judged.values()) == {1},
                       dict(judged=sorted(collections_count(judged.values()).items()), exempt={job: attempts.get(job) for job in sorted(exempt)}))
        events = run.cluster.events(self.offset)
        timeouts = sorted({e['timeout'] for e in events if e['kind'] == 'start' and e['sessions'] & self.cohort})
        case.check(f'every cohort publication statement ran with statement_timeout {self.publication_timeout} (the effective publication timeout)',
                   timeouts == [self.publication_timeout], timeouts)
        case.check('PIDs unchanged: the three processes started for the case are still running',
                   all(s.alive() and s.pid == self.pids[name] for name, s in self.trio.items()), {name: s.summary() for name, s in self.trio.items()})
        alive = all(s.alive() for s in self.trio.values())
        afterwards = {'chronicle.rest': clients.chronicle_rest()[0], 'haystack.item': clients.haystack_item()[0], 'manure.list': clients.manure_list()[0]} if alive else {}
        case.check('all three answer 200 afterwards (Chronicle REST, Haystack item GET, Manure list; decoded success)',
                   afterwards and all(v == 'ok' for v in afterwards.values()), afterwards)
        probe = clients.ingest(session_payload(SESSIONS, self.tag + '-after', self.rng)) if alive else None
        after = [e for e in run.cluster.events(self.offset) if e['kind'] == 'request' and probe is not None and probe['sessionId'] in e['sessions']]
        case.check(f'the request path still runs with statement_timeout {self.request_timeout} afterwards (a new ingest\'s revision insert)',
                   bool(after) and all(e['timeout'] == self.request_timeout for e in after), [e['timeout'] for e in after])
        complete = {self.job_sessions[job] for job in self.jobs if run.cluster.sql('chronicle', f"SELECT state FROM ch_jobs WHERE id = '{job}'")[0][0] == 'Complete'}
        rows = dict(run.cluster.sql('chronicle', 'SELECT session_id, count(*) FROM ch_search_chunks WHERE session_id IN ('
                                    + ','.join(f"'{s}'" for s in self.cohort) + ') GROUP BY 1'))
        slow = {s for e in events if e['kind'] == 'done' and e['seconds'] == TRIGGER_S and e['timeout'] == self.publication_timeout
                for s in e['sessions'] & complete if int(rows.get(s, 0)) > 0}
        case.late_valid(f'every Complete job published through the {TRIGGER_S} s trigger under the {self.publication_timeout} publication timeout: a completed '
                        f'{TRIGGER_S} s sleep of its session and its search rows', complete and slow == complete, dict(complete=len(complete), throughSlowTrigger=len(slow)))
        case.measurements.update(jobs=final, attempts=sorted(collections_count(attempts.values()).items()), publicationStatementTimeouts=timeouts,
                                 triggerEvents={kind: sum(1 for e in events if e['kind'] == kind) for kind in ('start', 'cancelled', 'done', 'request')})
        return final, events

    def close(self):
        if self.sampler is not None:
            for at, value in self.sampler.stop():
                self.timeline.write(json.dumps(dict(t=round(at - self.run.t0, 2), **value)) + '\n')
        if self.timeline is not None:
            self.timeline.close()
        self.trio.stop()


def collections_count(values):
    counts = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return counts


def case_3a(run):
    case = Case(run, '3a', 'SMALL scope (R-a reduced, rule set r4): publication slower than the request timeout after a PostgreSQL restart with the database '
                           'up -> 0 jobs terminally Failed and 0 attempts charged for the transient class. [workload of case 3: 20 sessions, '
                           '`statementTimeoutMs` 2000, `publicationStatementTimeoutMs` 10000; one `restart -m fast` right after the ingest, the database '
                           'up afterwards; r5: the trigger sleeps 12 s until the first cohort publication after the restart is cancelled (57014, a '
                           'transient failure with the database up), then 3 s]')
    work = Cohort(run, case, '3a')
    try:
        if not work.ready:
            return case.result()
        run.cluster.sql('chronicle', f'UPDATE restart_acc_control SET seconds = {WINDOW_TRIGGER_S}')
        record = work.restart('fast', 0, 0, now())
        work.replaced(record)
        ready, cancels, deadline = record['readyMarker'] or time.time(), [], now() + FIRST_PUBLICATION_S + WINDOW_TRIGGER_S
        while now() < deadline and not cancels:
            cancels = [e for e in run.cluster.events(work.offset) if e['kind'] == 'cancelled' and e['sessions'] & work.cohort
                       and e['seconds'] == WINDOW_TRIGGER_S and e['wall'] >= ready]
            time.sleep(POLL_S)
        run.cluster.sql('chronicle', f'UPDATE restart_acc_control SET seconds = {TRIGGER_S}')
        if not case.valid(f'a transient publication failure with the database up: a cohort publication after the restart\'s readiness cancelled (57014) '
                          f'while sleeping {WINDOW_TRIGGER_S} s', bool(cancels),
                          None if not cancels else dict(sessions=sorted(cancels[0]['sessions']), statementTimeout=cancels[0]['timeout'])):
            return case.result()
        work.settle(now(), charged=True)
        events = run.cluster.events(work.offset)
        cancels = [e for e in events if e['kind'] == 'cancelled' and e['sessions'] & work.cohort and e['seconds'] == WINDOW_TRIGGER_S and e['wall'] >= ready]
        session_jobs = {session: job for job, session in work.job_sessions.items()}
        failed = {session_jobs[s]: min(e['wall'] for e in cancels if s in e['sessions']) for e in cancels for s in e['sessions'] & work.cohort}
        holds = strict_holds(work.trio['chronicle'], work.job_sessions)
        held = {h['jobId'] for h in holds if h['jobId'] in failed and h['stage'] == 'Publication' and h['sqlState'] == '57014'
                and failed[h['jobId']] - 2 <= h['wall'] <= failed[h['jobId']] + CORRELATE_S}
        case.check('every cohort job whose publication was cancelled held for it: a strictly parsed `job held` line of that job, stage Publication, '
                   f'sqlState 57014, at most {CORRELATE_S} s after the cancellation', set(failed) <= held,
                   dict(cancelledJobs=sorted(failed), held=sorted(held)))
        slower = {job for job, at in failed.items() if any(e['kind'] == 'done' and work.job_sessions[job] in e['sessions'] and e['seconds'] == TRIGGER_S
                                                            and e['timeout'] == work.publication_timeout and e['wall'] > at for e in events)}
        case.check(f'every cancelled job later published at {TRIGGER_S} s under the {work.publication_timeout} publication timeout (slower than the request '
                   'timeout)', set(failed) == slower, dict(cancelledJobs=sorted(failed), publishedSlowAfterwards=sorted(slower)))
        case.measurements.update(restart={k: v for k, v in record.items() if k != 'leases'}, cancelledJobs=len(failed), holds=[h['line'] for h in holds[:5]])
        return case.result()
    finally:
        work.close()


def case_3b(run):
    case = Case(run, '3b', 'SMALL scope (R-a reduced, rule set r5): a PostgreSQL restart that ends at least 10 s before the in-flight job\'s lease ends '
                           'charges no attempt (the job held, later Complete); longer outages charge one attempt through reclaim and can lose one paid model '
                           'answer (out of the case); crashed jobs resume as today. [workload of case 3, trigger 3 s; one `restart -m immediate` while '
                           'cohort publications sleep in the trigger; restart duration and each job\'s lease margin measured]')
    work = Cohort(run, case, '3b')
    try:
        if not work.ready or not work.first_publication():
            return case.result()
        record = work.restart('immediate', 0, RESTART_SLOT_S, now())
        work.replaced(record)
        work.interrupted(record)
        session_jobs = {session: job for job, session in work.job_sessions.items()}
        interrupted_jobs = sorted({session_jobs[s] for p in record['interrupted'] for s in p['sessions']})
        ready = record['readyMarker']
        # Margin = lease_until (sampled right before the restart) − the restart's end (the new postmaster's `ready to accept
        # connections`); SMALL's guarantee covers a job only with a margin of at least LEASE_MARGIN_S.
        margins = {job: None if ready is None else until - ready for job, until in record['leases'].items()}  # unrounded: compared below
        in_scope = sorted(job for job in interrupted_jobs if margins.get(job) is not None and margins[job] >= LEASE_MARGIN_S)
        exempt = frozenset(job for job, margin in margins.items() if margin is None or margin < LEASE_MARGIN_S)
        case.valid(f'an interrupted job in the guarantee\'s scope: the restart (measured {record["outageSeconds"]} s, shutdown request to readiness) ended '
                   f'at least {LEASE_MARGIN_S} s before its lease end (or a cohort job had already Failed)',
                   bool(in_scope) or (not interrupted_jobs and record['cohortFailedBefore'] > 0),
                   dict(restartSeconds=record['outageSeconds'], leaseMarginSeconds={job: None if margins.get(job) is None else round(margins[job], 1) for job in interrupted_jobs},
                        inScope=in_scope))
        work.settle(now(), charged=True, exempt=exempt)
        holds = strict_holds(work.trio['chronicle'], work.job_sessions)
        held = {h['jobId'] for h in holds if record['shutdownMarker'] is not None and ready is not None and h['stage'] == 'Publication'
                and RESTART_SQLSTATE.match(h['sqlState']) and record['shutdownMarker'] <= h['wall'] <= ready + CORRELATE_S}
        case.check(f'every interrupted job in scope held for its interrupted publication: a strictly parsed `job held` line of that job, stage Publication, '
                   f'a connection-loss/shutdown sqlState (08xxx, 57P01-57P03), between the shutdown request and {CORRELATE_S} s after readiness',
                   in_scope and set(in_scope) <= held,
                   dict(inScope=in_scope, held=sorted(held), holdsOfInterruptedJobs=[(h['jobId'], h['stage'], h['sqlState'], round(h['wall'], 3))
                                                                             for h in holds if h['jobId'] in interrupted_jobs]))
        case.measurements.update(restart={k: v for k, v in record.items() if k != 'leases'}, holds=[h['line'] for h in holds[:5]])
        return case.result()
    finally:
        work.close()


def case_3(run):
    case = Case(run, '3', 'Restart under indexing load, publication slower than requests: 20 synthetic sessions; `statementTimeoutMs` 2000, '
                          '`publicationStatementTimeoutMs` 10000; trigger on `ch_search_chunks` 3 s per statement, 12 s for 2 min (57014); in that '
                          'window `pg_ctl restart -m fast` twice, `-m immediate` once -> 0 Failed of the 20, all Complete within 20 min after the last '
                          'restart, >= 1 `job held` line (else INVALID), PIDs unchanged, all three 200 afterwards. [full design: the POOL/R-a2 run, rule set r4]')
    work = Cohort(run, case, '3')
    try:
        if not work.ready or not work.first_publication():
            return case.result()
        window, window_wall = now(), time.time()
        run.cluster.sql('chronicle', f'UPDATE restart_acc_control SET seconds = {WINDOW_TRIGGER_S}')
        case.note(f'window opens (trigger {WINDOW_TRIGGER_S} s): {json.dumps(case3_sample(run, work.jobs))}')
        restarts = [work.restart(mode, earliest, latest, window) for earliest, latest, mode in RESTARTS]
        last_restart = now()
        sleep_until(window + WINDOW_S)
        run.cluster.sql('chronicle', f'UPDATE restart_acc_control SET seconds = {TRIGGER_S}')
        window_end, window_end_wall = now(), time.time()
        case.note(f'window closes (trigger {TRIGGER_S} s) after {window_end - window:.0f} s: {json.dumps(case3_sample(run, work.jobs))}')
        for record in restarts:
            work.replaced(record, window_end - window)
            work.interrupted(record)
        cancels = [e for e in run.cluster.events(work.offset) if e['kind'] == 'cancelled' and e['sessions'] & work.cohort and e['seconds'] == WINDOW_TRIGGER_S
                   and window_wall <= e['wall'] <= window_end_wall]
        case.valid('57014 inside the window: a cohort publication cancelled by its statement timeout while sleeping 12 s', bool(cancels),
                   dict(cancellations=len(cancels), statementTimeouts=sorted({e['timeout'] for e in cancels})))
        final, events = work.settle(last_restart, charged=False)
        holds = strict_holds(work.trio['chronicle'], work.job_sessions)
        correlated = [h for h in holds if h['stage'] == 'Publication' and h['sqlState'] == '57014'
                      and any(e['kind'] == 'cancelled' and h['session'] in e['sessions'] and e['seconds'] == WINDOW_TRIGGER_S
                              and e['timeout'] == work.publication_timeout and h['wall'] - CORRELATE_S <= e['wall'] <= h['wall'] + 2 for e in events)]
        case.measurements.update(restarts=[{k: v for k, v in r.items() if k != 'leases'} for r in restarts], holds=len(holds), correlatedHolds=len(correlated),
                                 firstHolds=[h['line'] for h in holds[:5]], holdStages=sorted({h['stage'] for h in holds}),
                                 holdSqlStates=sorted({h['sqlState'] for h in holds}), terminalTransientLines=len(lines_of(work.trio['chronicle'], TERMINAL)))
        case.late_valid('a correlated hold: a strictly parsed `job held` line of a cohort job, stage Publication, sqlState 57014, at most '
                        f'{CORRELATE_S} s after its session\'s 57014 in the trigger under the {work.publication_timeout} publication timeout',
                        bool(correlated), [h['line'] for h in correlated[:3]])
        return case.result()
    finally:
        work.close()


CASES = {'1': case_1, '2b': case_2b, '2': case_2, '5': case_5, '6': case_6, '4': case_4, '3a': case_3a, '3b': case_3b, '3': case_3}


# ---------------------------------------------------------------- self-check

SAMPLE_LINES = (  # the formats of spec §1 (R-c), §3 (R-b), §4 (R-a): raw, and as Chronicle's logger prints them
    'haystack database-wait code=jdbc-57P03',
    'manure database-wait code=jdbc-08001',
    'chronicle database-wait ready seconds=12',
    'I 2026-11-23T02:00:00.000 (DatabaseWait.scala:1)  ponygirls.runtime.DatabaseWait [1:io-compute-1] chronicle database-wait code=code=jdbc-57P03',
    'haystack failure stage=database-wait code=jdbc-57P03 error=JdbcFailure message="database-wait-timeout"',
    'chronicle failure stage=bind code=address-in-use error=BindException message="address in use" port=37267',
    'job held jobId=0193e8d5-6f5c-7a1b-8c2d-000000000001 code=database-transient sqlState=57014 class=JdbcFailure stage=Publication consecutive=1 '
    'nextAttemptAt=2026-11-23T02:01:00Z',
    'W 2026-11-23T02:00:00.000 (Models.scala:1)  chronicle.Worker.process [1:io-compute-1       ] job held jobId=claim=0193e8d5-6f5c-7a1b-8c2d-000000000001 '
    'code=code=database-transient sqlState=sql_state=08006 class=error_class=JdbcFailure stage=stage=Publication consecutive=k=2 '
    'nextAttemptAt=next=2026-11-23T02:02:00Z',
    'W 2026-11-23T02:00:00.000 (Models.scala:1)  chronicle.Worker.process [1:io-compute-1] job failed jobId=claim=0193e8d5-6f5c-7a1b-8c2d-000000000001 '
    'code=code=database-transient sqlState=sql_state=none class=error_class=LeaseLost stage=stage=Publication consecutive=k=10 nextAttemptAt=next=none',
    'haystack: ready',
    'MANURE_READY {"apiOrigin":"http://127.0.0.1:1","port":1,"pid":2}',
    '\x1b[32mI 2026-11-23T02:00:00.000 (Main.scala:83)  chronicle.Main$.serve [135:io-compute-26] chronicle listening address=server=/127.0.0.1:1 '
    'workersEnabled=workers_enabled=true\x1b[0m',
)
NEAR_MISSES = (  # lines no pattern may take: today's charged failure (the base's case 3 output), a failure printed as a wait, incomplete events
    'W 2026-11-23T02:54:00.503 (Models.scala:416)  chronicle.Worker.process [112:io-compute-87] job failed jobId=claim=aa295be5-2f17-48bb-b1d3-acf38e77b03f '
    'code=code=worker-fault exceptionClass=exception_class=ponygirls.runtime.JdbcFailure sqlState=sql_state=57014',
    'haystack database-wait code=jdbc-57P03 error=JdbcFailure',
    'job held jobId=0193e8d5-6f5c-7a1b-8c2d-000000000001 code=database-transient sqlState=57014 class=JdbcFailure stage=Publication consecutive=1',
    'note: chronicle job held jobId=0193e8d5-6f5c-7a1b-8c2d-000000000001 code=database-transient sqlState=57014 class=JdbcFailure stage=Publication '
    'consecutive=1 nextAttemptAt=2026-11-23T02:01:00Z',
    'job held jobId=not-a-uuid code=database-transient sqlState=57014 class=JdbcFailure stage=Publication consecutive=1 nextAttemptAt=2026-11-23T02:01:00Z',
)


def parse(line):
    text = ANSI.sub('', line)
    parsed = {name: pattern.search(text).groups() for name, pattern in (('wait', WAIT), ('waitReady', WAIT_READY), ('failure', FAILURE), ('held', HELD),
                                                                        ('terminal', TERMINAL)) if pattern.search(text)}
    return text, parsed | {f'ready.{name}': True for name, pattern in READY.items() if pattern.search(text)}


def self_check():
    """The interlocks refuse what this run does not own, PostgreSQL tools get no inherited override, and the line
    patterns take the spec's formats and nothing near them. No packages, no cluster; seconds."""
    failures = []

    def refused(label, action):
        try:
            action()
        except Refused as error:
            print(f'ok - refused: {label} ({error})', flush=True)
            return
        failures.append(label)
        print(f'not ok - accepted: {label}', flush=True)

    root, other, foreign, listener = Root(), Root(), Path(tempfile.mkdtemp(prefix='restart-acc-foreign.', dir=SHORT_TMP)), None
    try:
        refused('a directory outside this run\'s root', lambda: root.owned(foreign))
        refused('another run\'s root', lambda: root.owned(other.path / 'pg/data'))
        os.environ.setdefault('PG_BIN', '/nonexistent')
        cluster = Cluster(root, foreign)
        refused('a data directory this run did not initialize (no provider marker)', cluster.owned_data)
        cluster.state.mkdir(mode=0o700)
        cluster.data.mkdir(mode=0o700)
        (cluster.state / 'ponygirls-provider-v1').write_text('postgresql-18\n')
        (cluster.data / 'postmaster.pid').write_text(f'{os.getpid()}\n{foreign}\n0\n{cluster.port}\n')
        refused('a postmaster.pid naming another data directory', cluster.owned_data)
        listener = spawn([sys.executable, '-c', 'import socket,sys,time\ns=socket.socket();s.bind(("127.0.0.1",0));s.listen();'
                          'print(s.getsockname()[1],flush=True);time.sleep(60)'], stdout=subprocess.PIPE, text=True)
        port = int(listener.stdout.readline())
        refused('a port another process listens on (credentials, probes)', lambda: owned_listener(port, os.getpid()))
        cluster.port = port
        (cluster.data / 'postmaster.pid').unlink()
        refused('starting PostgreSQL on a taken port', cluster.start)
        (cluster.data / 'postmaster.pid').write_text(f'{os.getpid()}\n{cluster.data}\n0\n{cluster.port}\n')
        refused('signalling a postmaster.pid (here naming this very process) without a postmaster identity this run captured', cluster.stop)
        refused('a role password to a port without an identified postmaster holding it', lambda: cluster.login_state('chronicle'))
        (cluster.data / 'postmaster.pid').unlink()
        (root.path / MARKER).write_text('someone else\n')
        refused('a root whose marker another run rewrote', lambda: root.owned(root.path / 'pg'))
        (root.path / MARKER).write_text(root.nonce + '\n')
        mine = socket.socket()
        mine.bind(('127.0.0.1', 0))
        mine.listen(1)
        held = holds_listener(mine.getsockname()[1], os.getpid())
        mine.close()
        print(f'{"ok" if held else "not ok"} - this process\'s own listener is recognized', flush=True)
        if not held:
            failures.append('own listener')
        os.environ.update(PGHOSTADDR='192.0.2.1', PGSERVICE='elsewhere', PONYGIRLS_PASSWORD_FILE='/elsewhere')
        leaked = sorted(k for k in clean_env() if k.startswith(('PG', 'PONYGIRLS_')))
        print(f'{"not ok" if leaked else "ok"} - PostgreSQL tools and the provider get no PG*/PONYGIRLS_* override: {leaked}', flush=True)
        if leaked:
            failures.append('environment overrides')
        stop_group(listener, KILL_WAIT_S)
        exited = not send(listener.pidfd, 0)
        print(f'{"ok" if exited else "not ok"} - a stopped and reaped process is not signalled again through its pidfd', flush=True)
        if not exited:
            failures.append('pidfd after exit')
        cluster.pidfd = None
        unsignalled = cluster.forced_stop() is False
        print(f'{"ok" if unsignalled else "not ok"} - a forced stop without a captured postmaster identity signals nothing (root kept)', flush=True)
        if not unsignalled:
            failures.append('forced stop without identity')
    finally:
        if listener is not None:
            stop_group(listener, KILL_WAIT_S)
        shutil.rmtree(foreign)
        other.remove()
        root.remove()
    for line in SAMPLE_LINES:
        text, parsed = parse(line)
        if len(parsed) != 1:
            failures.append(text)
        print(f'{"ok" if len(parsed) == 1 else "not ok"} - parsed {text!r}: {parsed}', flush=True)
    for line in NEAR_MISSES:
        text, parsed = parse(line)
        if parsed:
            failures.append(text)
        print(f'{"not ok" if parsed else "ok"} - not taken {text!r}: {parsed}', flush=True)
    print(json.dumps(dict(selfCheck='passed' if not failures else 'failed', failures=failures)), flush=True)
    return 0 if not failures else 1


# ---------------------------------------------------------------- main

def terminated(signum, frame):
    raise SystemExit(128 + signum)


def main(argv):
    usage = 'usage: restart-acceptance.py SMALL|POOL [CASE...] | self-check   (cases: ' + ' '.join(ORDER) + ')'
    if argv == ['self-check']:
        return self_check()
    if not argv or argv[0] not in SETS or any(case not in CASES for case in argv[1:]):
        print(usage, file=sys.stderr)
        return 2
    set_name, selected = argv[0], [case for case in ORDER if case in (argv[1:] or CASES_OF[argv[0]])]
    calibration = None
    if set_name == 'POOL' and '6' in selected:
        path = os.environ.get('RESTART_ACC_CALIBRATION')
        try:
            assert path, 'RESTART_ACC_CALIBRATION is not set'
            calibration = load_calibration(path)
        except (OSError, ValueError, KeyError, AssertionError, StopIteration) as error:
            print(f'POOL case 6 needs RESTART_ACC_CALIBRATION=<a SMALL run\'s report.json with a BASELINE case 6 of this workload>: {error}', file=sys.stderr)
            return 2
    out = Path(os.environ['RESTART_ACC_OUT'])
    if not out.is_absolute() or (out.exists() and any(out.iterdir())):
        print('RESTART_ACC_OUT must be an absolute path to a new or empty directory', file=sys.stderr)
        return 2
    packages = {name: Path(os.environ[f'RESTART_ACC_{name.upper()}']).resolve(strict=True) for name in SERVICES}
    for name, package in packages.items():
        if not (package / 'bin' / f'{name}-server').is_file():
            print(f'{package} has no bin/{name}-server', file=sys.stderr)
            return 2
    out.mkdir(mode=0o700, parents=True, exist_ok=True)
    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, terminated)
    started_at, results, run = datetime.datetime.now(datetime.UTC).isoformat(timespec='seconds'), [], None
    try:
        run = Run(set_name, out, packages, calibration)
        note(f'restart acceptance, set {set_name}, cases {" ".join(selected)}, packages {json.dumps({k: str(v) for k, v in packages.items()})}, root {run.root.path}')
        run.setup()
        for ident in selected:
            try:
                results.append(CASES[ident](run))
            except (AssertionError, Refused, OSError, subprocess.SubprocessError, ValueError, KeyError) as error:
                print(f'case {ident}: INVALID (harness: {type(error).__name__}: {str(error)[:1000]})', flush=True)
                results.append(dict(case=ident, verdict='INVALID', harnessError=f'{type(error).__name__}: {str(error)[:2000]}'))
    finally:
        for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(signum, signal.SIG_IGN)
        if run is not None:
            run.cleanup()
    verdicts = {r['case']: r['verdict'] for r in results}
    summary = dict(set=set_name, startedAt=started_at, wallSeconds=round(now() - run.t0, 1), verdicts=verdicts, cases=results)
    (out / 'report.json').write_text(json.dumps(summary, indent=1))
    print(json.dumps(dict(set=set_name, wallSeconds=summary['wallSeconds'], verdicts=verdicts)), flush=True)
    values = set(verdicts.values())
    return 1 if 'FAIL' in values else 3 if 'INVALID' in values else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
