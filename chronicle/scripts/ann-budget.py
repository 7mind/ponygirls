#!/usr/bin/env python3
"""Semantic legs crowded by invisible index entries at production scale: see chronicle/scripts/test-ann-budget.sh."""
import base64, hashlib, json, os, re, secrets, signal, socket, struct, subprocess, sys, threading, time, urllib.error, urllib.request, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SERVER = Path(os.environ['CHRONICLE_SERVER'])
PG = Path(os.environ['POSTGRES_HOME']) / 'bin'
DATA = Path(os.environ['ANN_DATA_DIR'])
SOCKETS = Path(os.environ.get('TMPDIR', '/tmp'))
INVISIBLE = int(os.environ.get('ANN_INVISIBLE_ROWS', '220000'))
HOLDERS = 8                  # open transactions holding the invisible rows (concurrent HNSW insertion)
DIMENSIONS = 768
BACKGROUND = 3000            # cloned sessions of 100 chunks
TOPIC_SESSIONS = 50          # of them on the query's topic
TOPICS = 400
LEG = 1000                   # SearchPolicy.candidatesPerLeg
PRODUCTION_FIRST_PASS = "SET LOCAL hnsw.iterative_scan=strict_order; SET LOCAL hnsw.ef_search=200; SET LOCAL hnsw.max_scan_tuples=200000; SET LOCAL hnsw.scan_mem_multiplier=4;"
QUERY = 'topicalpha'
checks, summary = [], {'invisibleRows': INVISIBLE, 'phases': {}}


def check(label, ok, detail=''):
    checks.append((label, ok))
    print(('ok - ' if ok else 'not ok - ') + label + (f' ({detail})' if detail else ''), flush=True)


# ---------------------------------------------------------------- synthetic embeddings (loopback stub model)

def stream(seed, n):
    out, i = [], 0
    while len(out) < n:
        out.extend(v / 2**31 - 1.0 for v in struct.unpack('>8I', hashlib.sha256(f'{i}:{seed}'.encode()).digest())); i += 1
    return out[:n]


def centroid(name):
    values = stream(f'centroid:{name}', DIMENSIONS); norm = sum(v * v for v in values) ** 0.5
    return [v / norm for v in values]


def embed(text):
    """`topic<name>` near that topic's centroid (a query closer than documents), anything else uniform."""
    found = re.search(r'topic([a-z0-9]+)', text); noise = stream(text, DIMENSIONS)
    if found is None:
        return noise
    scale = 0.01 if text.startswith('query: ') else 0.03
    return [c + scale * u for c, u in zip(centroid(found[1]), noise)]


def literal(values):
    return '[' + ','.join(f'{v:.7g}' for v in values) + ']'


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def reply(self, value):
        body = json.dumps(value).encode(); self.send_response(200); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/v1/chat/completions':
            source = json.loads(request['messages'][1]['content']); n = len(source['fragments'])
            parts = [{'kind': 'Problem', 'start': {'fragmentIndex': 0, 'scalarOffset': 0}, 'end': {'fragmentIndex': n, 'scalarOffset': 0},
                      'continuePrevious': source.get('previous') is not None, 'summary': 'Synthetic annotation', 'tags': ['synthetic']}]
            return self.reply({'choices': [{'message': {'role': 'assistant', 'content': json.dumps({'parts': parts})}, 'finish_reason': 'stop'}]})
        return self.reply({'data': [{'index': i, 'embedding': embed(t)} for i, t in enumerate(request['input'])]})


# ---------------------------------------------------------------- owned cluster

def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); return s.getsockname()[1]


PORT = free_port()


def psql(sql, user='postgres', timeout=7200):
    out = subprocess.run([str(PG / 'psql'), '-X', '-h', str(SOCKETS), '-p', str(PORT), '-U', user, '-d', 'chronicle', '-v', 'ON_ERROR_STOP=1', '-qAt', '-F', '|'],
                         input=sql, text=True, capture_output=True, timeout=timeout)
    if out.returncode:
        raise RuntimeError(out.stderr[-3000:])
    return [line.split('|') for line in out.stdout.splitlines() if line]


def cluster():
    data = DATA / 'pgdata'
    subprocess.run([str(PG / 'initdb'), '-D', str(data), '-U', 'postgres', '--auth-local=trust', '--auth-host=scram-sha-256', '--no-locale', '-E', 'UTF8'],
                   check=True, capture_output=True)
    with (data / 'postgresql.conf').open('a') as conf:
        conf.write(f"listen_addresses='127.0.0.1'\nport={PORT}\nunix_socket_directories='{SOCKETS}'\nshared_buffers='4GB'\nmaintenance_work_mem='4GB'\n"
                   "max_parallel_maintenance_workers=8\nmax_wal_size='8GB'\nautovacuum=off\nfsync=off\nsynchronous_commit=off\nfull_page_writes=off\n")
    subprocess.run([str(PG / 'pg_ctl'), '-D', str(data), '-l', str(DATA / 'postgres.log'), '-w', 'start'], check=True, capture_output=True)
    password = secrets.token_urlsafe(24)
    (DATA / 'database-password').write_text(password + '\n'); (DATA / 'database-password').chmod(0o600)
    subprocess.run([str(PG / 'psql'), '-X', '-h', str(SOCKETS), '-p', str(PORT), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-v', f'pw={password}'],
                   input="CREATE ROLE chronicle LOGIN PASSWORD :'pw';\nCREATE DATABASE chronicle OWNER chronicle;\n", text=True, check=True, capture_output=True)
    # The production role settings (deploy4 evidence 15): the second pass's 5 s deadline sits under them.
    psql("CREATE EXTENSION vector; CREATE EXTENSION pg_trgm;"
         "ALTER ROLE chronicle IN DATABASE chronicle SET statement_timeout='30s'; ALTER ROLE chronicle IN DATABASE chronicle SET lock_timeout='35s';"
         "ALTER ROLE chronicle IN DATABASE chronicle SET idle_in_transaction_session_timeout='60s'; ALTER ROLE chronicle IN DATABASE chronicle SET work_mem='4MB';")


def stop_cluster():
    subprocess.run([str(PG / 'pg_ctl'), '-D', str(DATA / 'pgdata'), '-m', 'fast', '-w', 'stop'], capture_output=True)


# ---------------------------------------------------------------- the server

class Server:
    def __init__(self, stub_origin, label):
        port = free_port(); self.origin = f'http://127.0.0.1:{port}'
        root = DATA / 'server'; root.mkdir(exist_ok=True); (root / 'home').mkdir(exist_ok=True)
        if not (root / 'password-hash').exists():
            (root / 'password').write_text('synthetic-ann-budget\n'); (root / 'empty').write_text('')
            (root / 'password-hash').write_text(subprocess.run([str(SERVER), 'password-hash'], input='synthetic-ann-budget\n', text=True, capture_output=True, check=True).stdout)
            for name in ('ingest', 'read'):
                (root / f'token-{name}').write_text(secrets.token_urlsafe(32) + '\n'); (root / f'token-{name}').chmod(0o600)
        self.root = root
        config = json.loads(Path('chronicle/config.example.json').read_text())
        config.update(listenPort=port, allowedOrigin=self.origin, jdbcUrl=f'jdbc:postgresql://127.0.0.1:{PORT}/chronicle', databaseUser='chronicle',
                      databasePasswordFile=str(DATA / 'database-password'),
                      databaseLimits={'maxConnections': 12, 'maxQueued': 24, 'queueTimeoutMs': 5000, 'connectTimeoutMs': 5000, 'statementTimeoutMs': 30000,
                                      'lockTimeoutMs': 35000, 'idleTransactionTimeoutMs': 60000, 'socketTimeoutMs': 35000},
                      users=[dict(id='alice', login='alice', passwordHashFile=str(root / 'password-hash'), enabled=True)],
                      staticTokens=[dict(id=str(uuid.UUID(int=1)), userId='alice', name='ingest', scopes=['Ingest'], tokenFile=str(root / 'token-ingest')),
                                    dict(id=str(uuid.UUID(int=2)), userId='alice', name='read', scopes=['Read'], tokenFile=str(root / 'token-read'))],
                      maxBodyBytes=268435456, maxFileBytes=268435456, maxMessages=100000)
        for kind, path in (('annotation', '/v1/chat/completions'), ('embedding', '/v1/embeddings')):
            config[kind].update(endpoint=stub_origin + path, credentialFile=str(root / 'empty'), model=f'stub-{kind}', revision='ann-budget', timeoutSeconds=60)
        config['annotation'].update(requestPolicy='strict-json-schema', maxResponseBytes=1048576)
        config['embedding'].update(dimensions=DIMENSIONS, sendDimensions=False, maxResponseBytes=16 * 1024 * 1024, queryPrefix='query: ', documentPrefix='passage: ')
        (root / f'{label}.json').write_text(json.dumps(config))
        log = (root / f'{label}.log').open('w')
        self.process = subprocess.Popen([str(SERVER), '-XX:MaxHeapSize=2g', 'serve', str(root / f'{label}.json')], stdout=log, stderr=subprocess.STDOUT,
                                        stdin=subprocess.DEVNULL, start_new_session=True, env=dict(os.environ, HOME=str(root / 'home')))
        deadline = time.monotonic() + 600
        while True:
            assert self.process.poll() is None, (root / f'{label}.log').read_text()[-3000:]
            try:
                with urllib.request.urlopen(self.origin + '/api/versions', timeout=1): break
            except OSError: pass
            assert time.monotonic() < deadline, 'server readiness'
            time.sleep(0.3)

    def stop(self):
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGTERM)
            try: self.process.wait(60)
            except subprocess.TimeoutExpired: os.killpg(self.process.pid, signal.SIGKILL); self.process.wait(10)

    def api(self, path, body, token):
        request = urllib.request.Request(self.origin + path, method='POST', data=json.dumps(body).encode(), headers={
            'Authorization': 'Bearer ' + (self.root / f'token-{token}').read_text().strip(), 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'})
        try:
            with urllib.request.urlopen(request, timeout=120) as r: return json.loads(r.read())
        except urllib.error.HTTPError as e: return json.loads(e.read() or b'null')

    def search(self, mode, **filters):
        """MCP search_sessions (JSON): (seconds, result or failure)."""
        t0 = time.monotonic()
        data = self.api('/mcp', dict(jsonrpc='2.0', id=str(uuid.uuid4()), method='tools/call', params=dict(name='search_sessions', arguments=dict(query=QUERY, mode=mode, limit=20, **filters))), 'read')
        seconds = round(time.monotonic() - t0, 3); result = data['result']; text = json.loads(result['content'][0]['text'])
        return seconds, ({'failure': text} if result['isError'] else text['Search']['result'])


class Browser:
    """The browser protocol over a minimal WebSocket client (cookie login, Hello; answers server pings)."""
    def __init__(self, origin):
        host, port = origin.removeprefix('http://').split(':')
        request = urllib.request.Request(origin + '/api/login', method='POST', data=json.dumps(dict(login='alice', password='synthetic-ann-budget')).encode(),
                                         headers={'Content-Type': 'application/json', 'Origin': origin})
        with urllib.request.urlopen(request, timeout=30) as r:
            cookie = next(v.split(';')[0] for n, v in r.headers.items() if n.lower() == 'set-cookie' and v.startswith('chronicle_session='))
        self.socket = socket.create_connection((host, int(port)), timeout=120)
        key = base64.b64encode(os.urandom(16)).decode()
        self.socket.sendall((f'GET /api/ws HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n'
                             f'Sec-WebSocket-Version: 13\r\nOrigin: {origin}\r\nCookie: {cookie}\r\n\r\n').encode())
        head = b''
        while b'\r\n\r\n' not in head: head += self.socket.recv(1)
        assert head.startswith(b'HTTP/1.1 101'), head
        assert 'Hello' in self.call({'Hello': {'versions': ['1.9.0']}})

    def exact(self, n):
        data = bytearray()
        while len(data) < n:
            chunk = self.socket.recv(n - len(data)); assert chunk, 'socket closed'; data += chunk
        return bytes(data)

    def send(self, value):
        payload = json.dumps(value).encode(); mask = os.urandom(4); n = len(payload)
        header = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + n.to_bytes(2, 'big') if n < 65536 else bytes([0x80 | 127]) + n.to_bytes(8, 'big'))
        self.socket.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def call(self, operation):
        request = str(uuid.uuid4()); self.send({'requestId': request, 'operation': operation})
        while True:
            first, second = self.exact(2); n = second & 0x7f
            n = int.from_bytes(self.exact(2 if n == 126 else 8), 'big') if n >= 126 else n
            payload = self.exact(n); opcode = first & 0x0f
            assert opcode != 8, 'socket closed by the server'
            if opcode != 1: continue
            envelope = json.loads(payload); result = envelope['result']
            if 'Ping' in result:
                self.send({'requestId': envelope['requestId'], 'operation': {'Pong': {'nonce': result['Ping']['nonce']}}}); continue
            if envelope['requestId'] == request: return result

    def archive(self):
        t0 = time.monotonic()
        result = self.call({'ArchiveSearch': {'query': {'expression': f'mode:semantic {QUERY}', 'sort': 'LastTimestamp', 'direction': 'Desc', 'cursor': None, 'limit': 10, 'preferRelevance': True}}})
        return round(time.monotonic() - t0, 3), result


# ---------------------------------------------------------------- data

def ingest_template(server):
    """One session of 100 chunks indexed and published by the server: the shape every background session copies."""
    texts = [(f'm{i} ' + 'background chunk words kettle lantern harbor meadow copper ' * 400)[:20450] for i in range(10)]
    raw = ''.join(json.dumps({'id': f'r{i}'}) + '\n' for i in range(len(texts))); digest = hashlib.sha256(raw.encode()).hexdigest()
    body = dict(requestId=str(uuid.uuid4()), source=dict(collectorNamespace='ann-budget', discoveryRootId='root', format='Pi', producerSessionId='template', subagentId=None),
                expectedRevision=0, digest=digest, completion='Quiescent', redacted=False,
                metadata=dict(title='template', project='main', workdir=None, gitRemote=None, gitBranch=None, gitCommit=None, producer='pi', model=None,
                              startedAt='2026-11-01T00:00:00Z', endedAt=None, tags=[]),
                messages=[dict(id=f'm{i}', parentId=None, role='user', text=t, timestamp='2026-11-01T00:00:00Z', recordIndex=i) for i, t in enumerate(texts)],
                files=[dict(path='session.jsonl', sha256=digest, content=raw)])
    receipt = server.api('/api/ingest', body, 'ingest')
    deadline = time.monotonic() + 600
    while psql(f"SELECT count(*) FROM ch_search_chunks WHERE session_id='{receipt['sessionId']}'")[0][0] != '100':
        assert time.monotonic() < deadline, 'template publication'
        time.sleep(1)
    return receipt['sessionId']


def background(template):
    """BACKGROUND copies of the template (own source, revision, generation, passage, pieces, spans, chunks, search
    rows), vectors synthetic: topic centroid + 0.03 U[-1,1] (TOPIC_SESSIONS on the query's topic, 20 % topic-less);
    project 'rare' = 10 sessions on other topics. Then the HNSW index is built once."""
    with (DATA / 'centroids.tsv').open('w') as f:
        for name in ['alpha'] + [f'x{i}' for i in range(TOPICS)]: f.write(f'{name}\t{literal(centroid(name))}\n')
    psql(f"""SET statement_timeout=0;
CREATE TABLE ann_topics(name text PRIMARY KEY, c vector);
\\copy ann_topics FROM '{DATA / 'centroids.tsv'}'
SELECT s.published AS tgen, s.source_key AS tkey FROM ch_sources s WHERE s.id='{template}' \\gset
CREATE TABLE ann_map AS SELECT n, md5('s'||n)::uuid AS session, md5('g'||n)::uuid AS generation, md5('j'||n)::uuid AS job,
  CASE WHEN n<={TOPIC_SESSIONS} THEN 'alpha' WHEN n%5=0 THEN NULL ELSE 'x'||(n%{TOPICS}) END AS topic,
  CASE WHEN n%300=137 THEN 'rare' ELSE 'main' END AS project FROM generate_series(1,{BACKGROUND}) n;
DROP INDEX ch_search_hnsw_d{DIMENSIONS};
BEGIN;
INSERT INTO ch_sources(id,owner,source_key,revision,published,tombstone) SELECT m.session,'alice',:'tkey'||':'||m.n,1,m.generation,false FROM ann_map m;
INSERT INTO ch_revisions(session_id,revision,snapshot,binding_id,epoch,envelope,message_count,record_count,raw_bytes,message_bytes,fragment_count,raw_state,message_chain,message_time)
  SELECT m.session,r.revision,r.snapshot,gen_random_uuid(),r.epoch,r.envelope,r.message_count,r.record_count,r.raw_bytes,r.message_bytes,r.fragment_count,r.raw_state,r.message_chain,r.message_time
  FROM ann_map m, ch_revisions r WHERE r.session_id='{template}';
INSERT INTO ch_revision_info(session_id,revision,metadata,source,completion,redacted,last_timestamp,last_timestamp_order,message_count,lexical_version)
  SELECT m.session,i.revision,jsonb_set(i.metadata,'{{project}}',to_jsonb(m.project)),jsonb_set(i.source,'{{producerSessionId}}',to_jsonb('bg'||m.n)),i.completion,i.redacted,
    i.last_timestamp,i.last_timestamp_order,i.message_count,i.lexical_version FROM ann_map m, ch_revision_info i WHERE i.session_id='{template}';
INSERT INTO ch_generations(id,session_id,revision,profile,passage_format,passage_count,retired,run_id)
  SELECT m.generation,m.session,g.revision,g.profile,g.passage_format,g.passage_count,g.retired,gen_random_uuid() FROM ann_map m, ch_generations g WHERE g.id=:'tgen';
INSERT INTO ch_jobs(id,session_id,revision,profile,state,attempts,fence,lease_until,error,completed_windows,total_windows,run_id,failure_stage,annotation_retry_epoch)
  SELECT m.job,m.session,j.revision,j.profile,j.state,j.attempts,j.fence,j.lease_until,j.error,j.completed_windows,j.total_windows,gen_random_uuid(),j.failure_stage,j.annotation_retry_epoch
  FROM ann_map m, ch_jobs j WHERE j.session_id='{template}';
INSERT INTO ch_problem_passages(generation,id,ordinal,initial_summary,value,span_count)
  SELECT m.generation,md5(m.n||':'||p.id)::uuid,p.ordinal,p.initial_summary,replace(replace(p.value::text,p.id::text,md5(m.n||':'||p.id)::uuid::text),'{template}',m.session::text)::jsonb,p.span_count
  FROM ann_map m, ch_problem_passages p WHERE p.generation=:'tgen';
INSERT INTO ch_generation_tags(generation,tag) SELECT m.generation,t.tag FROM ann_map m, ch_generation_tags t WHERE t.generation=:'tgen';
INSERT INTO ch_chunks(id,generation,value,document,embedding,ordinal)
  SELECT md5(m.n||':'||c.id)::uuid,m.generation,jsonb_set(jsonb_set(c.value,'{{id}}',to_jsonb(md5(m.n||':'||c.id)::uuid::text)),'{{sessionId}}',to_jsonb(m.session::text)),
    c.document||to_tsvector('english',coalesce('topic'||m.topic,'notopic')),
    CASE WHEN m.topic IS NULL THEN v.r ELSE t.c + v.r*array_fill(0.03::real,ARRAY[{DIMENSIONS}])::vector END,c.ordinal
  FROM ann_map m CROSS JOIN ch_chunks c LEFT JOIN ann_topics t ON t.name=m.topic
  CROSS JOIN LATERAL (SELECT array_agg(random()*2-1)::vector AS r FROM generate_series(1,{DIMENSIONS}) WHERE c.ordinal>=0 AND m.n>0) v WHERE c.generation=:'tgen';
INSERT INTO ch_problem_pieces(generation,chunk_id,passage_ordinal,piece_ordinal)
  SELECT m.generation,md5(m.n||':'||p.chunk_id)::uuid,p.passage_ordinal,p.piece_ordinal FROM ann_map m, ch_problem_pieces p WHERE p.generation=:'tgen';
INSERT INTO ch_problem_spans(generation,passage_id,ordinal,message_id,message_position,start_byte,end_byte)
  SELECT m.generation,md5(m.n||':'||s.passage_id)::uuid,s.ordinal,s.message_id,s.message_position,s.start_byte,s.end_byte FROM ann_map m, ch_problem_spans s WHERE s.generation=:'tgen';
INSERT INTO ch_search_chunks(id,generation,session_id,revision,profile,document,embedding)
  SELECT ch.id,ch.generation,g.session_id,g.revision,g.profile,ch.document,ch.embedding FROM ann_map m JOIN ch_generations g ON g.id=m.generation JOIN ch_chunks ch ON ch.generation=g.id;
COMMIT;
CREATE INDEX ch_search_hnsw_d{DIMENSIONS} ON ch_search_chunks USING hnsw ((l2_normalize(embedding)::halfvec({DIMENSIONS})) halfvec_cosine_ops) WHERE vector_dims(embedding)={DIMENSIONS};
VACUUM ANALYZE;
INSERT INTO ch_sources(id,owner,source_key,revision,published,tombstone) VALUES(md5('invisible')::uuid,'alice','ann-budget-invisible',0,NULL,false);
""")


def hold_invisible():
    """HOLDERS open transactions inserting INVISIBLE search rows (generations of a source without a publication), all
    nearer the query than every visible row; each then waits. Returns the psql processes once every row is in."""
    per = INVISIBLE // HOLDERS; holders = []
    for k in range(HOLDERS):
        script = f"""SET statement_timeout=0;
BEGIN;
INSERT INTO ch_generations(id,session_id,revision,profile,passage_format,passage_count,run_id)
  SELECT md5('invisible-{k}')::uuid,md5('invisible')::uuid,1,profile,'ContextAwareProblems',0,gen_random_uuid() FROM ch_index_profiles LIMIT 1;
INSERT INTO ch_chunks(id,generation,value,document,embedding,ordinal) SELECT md5('invisible-{k}-'||i)::uuid,md5('invisible-{k}')::uuid,'{{}}'::jsonb,to_tsvector('english','topicalpha'),
  t.c + (SELECT array_agg(random()*2-1)::vector FROM generate_series(1,{DIMENSIONS}) WHERE i>0)*array_fill(0.003::real,ARRAY[{DIMENSIONS}])::vector,i
  FROM generate_series(1,{per}) i, ann_topics t WHERE t.name='alpha';
INSERT INTO ch_search_chunks(id,generation,session_id,revision,profile,document,embedding)
  SELECT ch.id,ch.generation,g.session_id,g.revision,g.profile,ch.document,ch.embedding FROM ch_chunks ch JOIN ch_generations g ON g.id=ch.generation WHERE g.id=md5('invisible-{k}')::uuid;
SELECT 'inserted';
SELECT pg_sleep(7200);
ROLLBACK;
"""
        process = subprocess.Popen([str(PG / 'psql'), '-X', '-h', str(SOCKETS), '-p', str(PORT), '-U', 'postgres', '-d', 'chronicle', '-qAt'], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        process.stdin.write(script); process.stdin.close(); holders.append(process)
    for process in holders:
        for line in process.stdout:
            assert not line.startswith(('ERROR', 'psql:')), line
            if line.strip() == 'inserted': break
    return holders


def release(holders):
    """Cancel the waits: each transaction rolls back, its rows dead until VACUUM."""
    psql("SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(7200)%' AND pid<>pg_backend_pid();")
    for process in holders: process.wait(120)


def exact(project=None):
    """The exact nearest LEG visible chunks' sessions by their best distance (original vectors, no index)."""
    q = literal(embed('query: ' + QUERY)); fs = f" AND r.metadata->>'project'='{project}'" if project else ''
    return [row[0] for row in psql(f"""SET statement_timeout=0; WITH v AS (SELECT s.id,s.published FROM ch_sources s JOIN ch_generations g ON g.id=s.published
      JOIN ch_revision_info r ON r.session_id=s.id AND r.revision=g.revision WHERE s.owner='alice' AND NOT s.tombstone{fs}),
      c AS (SELECT ch.session_id,ch.embedding <=> '{q}'::vector AS d FROM v JOIN ch_search_chunks ch ON ch.session_id=v.id AND ch.generation=v.published ORDER BY d LIMIT {LEG})
      SELECT session_id FROM c GROUP BY session_id ORDER BY min(d),session_id;""")]


def first_pass_rows():
    """The leg's first pass alone (production budget), as role chronicle: rows of {LEG} and milliseconds."""
    q = literal(embed('query: ' + QUERY))
    rows = psql(f"""BEGIN ISOLATION LEVEL REPEATABLE READ; {PRODUCTION_FIRST_PASS}
\\timing on
SELECT count(*) FROM (SELECT ch.id FROM ch_search_chunks ch WHERE vector_dims(ch.embedding)={DIMENSIONS} AND (SELECT true FROM ch_sources s JOIN ch_revision_info r
  ON r.session_id=s.id AND r.revision=ch.revision WHERE s.id=ch.session_id AND s.published=ch.generation AND s.owner='alice' AND NOT s.tombstone OFFSET 0)
  ORDER BY l2_normalize(ch.embedding)::halfvec({DIMENSIONS}) <=> l2_normalize('{q}'::vector)::halfvec({DIMENSIONS}) LIMIT {LEG}) leg;
COMMIT;""", user='chronicle')
    values = [r[0] for r in rows]
    count = next(v for v in values if not v.startswith('Time:'))
    return int(count), float(values[values.index(count) + 1].split()[1])


def measure(label, server, browser):
    window, rare = exact(), exact('rare')
    record = dict(exactWindowSessions=len(window), exactRareSessions=len(rare), firstPass=first_pass_rows())
    seconds, semantic = server.search('semantic')
    record['semantic'] = dict(seconds=seconds, **({'failure': semantic['failure']} if 'failure' in semantic else dict(total=semantic['total'],
                             top20Shared=len(set(window[:20]) & {h['session']['id'] for h in semantic['hits']}))))
    seconds, hybrid = server.search('hybrid')
    record['hybrid'] = dict(seconds=seconds, **({'failure': hybrid['failure']} if 'failure' in hybrid else dict(total=hybrid['total'])))
    seconds, filtered = server.search('semantic', project='rare')
    record['rare'] = dict(seconds=seconds, **({'failure': filtered['failure']} if 'failure' in filtered else dict(total=filtered['total'],
                          sessions=sorted(h['session']['id'] for h in filtered['hits']) == sorted(rare))))
    seconds, archive = browser.archive()
    page = archive.get('ArchiveSearch', {}).get('result', {}).get('page')
    record['archive'] = dict(seconds=seconds, **(dict(total=int(page['total'])) if page else {'failure': archive.get('Error', {}).get('failure', archive)}))
    summary['phases'][label] = record
    print(json.dumps({label: record}), flush=True)

    def answered(value, complete):
        return 'failure' in value and value['failure'].get('code') == 'unavailable' or 'failure' not in value and complete(value)
    check(f'{label}: semantic is the complete window or unavailable', answered(record['semantic'], lambda v: v['total'] >= 0.9 * len(window) and v['top20Shared'] >= 18), record['semantic'])
    check(f'{label}: hybrid answers or is unavailable as a whole', 'failure' not in record['hybrid'] or record['hybrid']['failure'].get('code') == 'unavailable', record['hybrid'])
    check(f'{label}: a project filter of {len(rare)} sessions is exact', 'failure' not in record['rare'] and record['rare']['sessions'], record['rare'])
    check(f'{label}: Archive search is the complete window or unavailable', answered(record['archive'], lambda v: v['total'] >= 0.9 * len(window)), record['archive'])
    return record


def main():
    assert not DATA.exists() or not any(DATA.iterdir()), 'ANN_DATA_DIR must be new or empty'
    DATA.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    stub = ThreadingHTTPServer(('127.0.0.1', 0), Stub); threading.Thread(target=stub.serve_forever, daemon=True).start()
    stub_origin = f'http://127.0.0.1:{stub.server_address[1]}'
    cluster(); server = None; holders = []
    try:
        server = Server(stub_origin, 'template'); template = ingest_template(server); server.stop()
        t0 = time.monotonic(); background(template); summary['backgroundSeconds'] = round(time.monotonic() - t0, 1)
        summary['searchRows'] = int(psql('SELECT count(*) FROM ch_search_chunks')[0][0])
        server = Server(stub_origin, 'search'); browser = Browser(server.origin)
        baseline = measure('baseline', server, browser)
        check('baseline: the first pass alone is full', baseline['firstPass'][0] == LEG, baseline['firstPass'])
        t0 = time.monotonic(); holders = hold_invisible(); summary['insertSeconds'] = round(time.monotonic() - t0, 1)
        crowded = measure('uncommitted', server, browser)
        check(f'uncommitted: {INVISIBLE} in-flight rows make the first pass alone short', crowded['firstPass'][0] < LEG, crowded['firstPass'])
        release(holders); holders = []
        dead = measure('dead', server, browser)
        check(f'dead: {INVISIBLE} rolled-back rows make the first pass alone short', dead['firstPass'][0] < LEG, dead['firstPass'])
    finally:
        for process in holders:
            if process.poll() is None: os.killpg(process.pid, signal.SIGTERM)
        if server: server.stop()
        stop_cluster(); stub.shutdown()
    summary.update(seconds=round(time.monotonic() - started, 1), checks=len(checks), failed=sum(not ok for _, ok in checks))
    print(json.dumps(summary), flush=True)
    sys.exit(1 if summary['failed'] else 0)


main()
