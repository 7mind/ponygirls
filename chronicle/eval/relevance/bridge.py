"""Split, loopback-only evaluator runner. No provider or daemon is launched."""
import argparse
import hashlib
import ipaddress
import json
import os
import signal
from pathlib import Path
import stat
import time
import uuid
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from evaluate import ROOT, digest, load, messages, save

CALL_LIMIT = 64
CALL_BYTES = 65536
TOTAL_BYTES = 1048576
TOTAL_SECONDS = 60
TOOLS = {'search_sessions': 'Search', 'get_session': 'Session', 'get_messages': 'Messages',
         'get_chunks': 'Chunks', 'search_tags': 'Facets', 'related_sessions': 'Related', 'whoami': 'Whoami', 'list_facets': 'Facets', 'ingest_status': 'Status'}


class ListenerNotReady(ValueError):
    pass


def deadline_expired(signum, frame):
    raise TimeoutError('attempt wall-clock deadline exhausted')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('redirect forbidden')


def loopback(origin):
    parsed = urlsplit(origin)
    if parsed.scheme != 'http' or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('bare http loopback origin required')
    if not ipaddress.ip_address(parsed.hostname).is_loopback or parsed.port is None:
        raise ValueError('numeric loopback host and explicit port required; DNS is forbidden')
    return parsed.port


def ownership(manifest):
    port = loopback(manifest['origin']); pid = manifest['pid']
    if type(pid) is not int or pid <= 0:
        raise ValueError('positive owned PID required')
    executable = Path(f'/proc/{pid}/exe')
    if executable.resolve() != Path(manifest['executable']).resolve() or digest(executable) != manifest['elfSha256']:
        raise ValueError('owned process executable/hash mismatch')
    sockets = {os.readlink(fd) for fd in Path(f'/proc/{pid}/fd').iterdir() if fd.is_symlink()}
    address = ipaddress.ip_address(urlsplit(manifest['origin']).hostname)
    addresses = [address] + ([ipaddress.IPv6Address('::ffff:' + str(address))] if address.version == 4 else [])
    for candidate in addresses:
        packed = candidate.packed
        expected = (packed[::-1] if candidate.version == 4 else b''.join(packed[i:i+4][::-1] for i in range(0, 16, 4))).hex().upper()
        table = 'tcp' if candidate.version == 4 else 'tcp6'
        for line in Path(f'/proc/{pid}/net/{table}').read_text().splitlines()[1:]:
            fields = line.split(); local, number = fields[1].split(':')
            if fields[3] == '0A' and local == expected and int(number, 16) == port and f'socket:[{fields[9]}]' in sockets:
                return
    raise ListenerNotReady('exact owned listener is not ready')


def validate_read(name, arguments, search_mode, related_policy):
    if search_mode not in ('lexical', 'semantic', 'hybrid') or related_policy not in ('allow', 'deny'):
        raise ValueError('explicit search mode and related policy required')
    if name not in TOOLS:
        raise ValueError('only allowlisted read-only tools')
    if name == 'search_sessions' and arguments.get('mode') != search_mode:
        raise ValueError('assigned search mode violation')
    if name == 'related_sessions' and related_policy != 'allow':
        raise ValueError('related_sessions forbidden by declared comparison policy')


class Bridge:
    def __init__(self, manifest, directory, task, ingest_allowed, *, search_mode, related_policy):
        ownership(manifest)
        self.manifest = manifest; self.directory = directory; self.task = task
        validate_read('whoami', {}, search_mode, related_policy)
        self.search_mode = search_mode; self.related_policy = related_policy
        self.ingest_allowed = ingest_allowed; self.started = time.monotonic(); self.calls = 0; self.bytes = 0
        self.trace = (directory / 'trace.jsonl').open('x')
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def close(self):
        self.trace.close()
        (self.directory / 'trace.jsonl').chmod(0o444)

    def post(self, path, payload, principal, tool, arguments):
        if path != '/mcp' and not (path == '/api/ingest' and self.ingest_allowed):
            raise ValueError('write bridge disabled')
        remaining = TOTAL_SECONDS - (time.monotonic() - self.started)
        if self.calls >= CALL_LIMIT or remaining <= 0 or self.bytes >= TOTAL_BYTES:
            raise ValueError('attempt budget exhausted')
        ownership(self.manifest)
        credential = Path(self.manifest['ingestTokenFiles' if path == '/api/ingest' else 'tokenFiles'][principal])
        if stat.S_IMODE(credential.stat().st_mode) != 0o600:
            raise ValueError('credential must have mode 0600')
        token = credential.read_text().strip()
        if not token or '\n' in token or '\r' in token:
            raise ValueError('invalid credential file')
        body = json.dumps(payload, ensure_ascii=False).encode()
        if len(body) > CALL_BYTES or self.bytes + len(body) > TOTAL_BYTES:
            raise ValueError('request byte budget exhausted')
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream',
                   'MCP-Protocol-Version': '2025-11-25', 'Authorization': 'Bearer ' + token}
        self.calls += 1; self.bytes += len(body); began = time.monotonic()
        event = {'taskId': self.task, 'tool': tool, 'arguments': arguments, 'call': self.calls, 'requestBytes': len(body)}
        if signal.getitimer(signal.ITIMER_REAL) != (0.0, 0.0):
            raise ValueError('bridge requires exclusive main-thread real-time timer')
        remaining = TOTAL_SECONDS - (time.monotonic() - self.started)
        if remaining <= 0:
            raise TimeoutError('attempt wall-clock deadline exhausted')
        previous_handler = signal.signal(signal.SIGALRM, deadline_expired)
        signal.setitimer(signal.ITIMER_REAL, remaining)
        try:
            request = Request(self.manifest['origin'].rstrip('/') + path, data=body, headers=headers)
            with self.opener.open(request, timeout=min(10, remaining)) as response:
                data = response.read(min(CALL_BYTES, TOTAL_BYTES - self.bytes) + 1)
                event['status'] = response.status
            self.bytes += len(data); event['responseBytes'] = len(data)
            if len(data) > CALL_BYTES or self.bytes > TOTAL_BYTES:
                raise ValueError('response byte budget exhausted')
            result = json.loads(data)
            if path == '/mcp':
                if result.get('id') != payload['id'] or 'error' in result:
                    raise ValueError('MCP RPC error or mismatched ID')
                content = result['result']
                if content['isError']:
                    raise ValueError('MCP tool error')
                result = json.loads(content['content'][0]['text'])[TOOLS[tool]]
                result = result['result'] if 'result' in result else result
            event['result'] = result
            return result
        except Exception as error:
            event['error'] = type(error).__name__
            raise
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0); signal.signal(signal.SIGALRM, previous_handler)
            event['elapsedMs'] = round((time.monotonic() - began) * 1000, 3)
            self.trace.write(json.dumps(event, ensure_ascii=False) + '\n'); self.trace.flush()

    def call(self, name, arguments, principal):
        validate_read(name, arguments, self.search_mode, self.related_policy)
        payload = {'jsonrpc': '2.0', 'id': self.calls + 1, 'method': 'tools/call', 'params': {'name': name, 'arguments': arguments}}
        return self.post('/mcp', payload, principal, name, arguments)


def ingest_payload(document, run_id):
    normalized = [dict(m, parentId=None, role='user', timestamp=None, recordIndex=i) for i, m in enumerate(messages(document))]
    raw = ''.join(json.dumps(m, ensure_ascii=False) + '\n' for m in normalized)
    sha = hashlib.sha256(raw.encode()).hexdigest()
    return {'requestId': str(uuid.uuid4()), 'source': {'collectorNamespace': 'relevance-eval', 'discoveryRootId': 'synthetic',
            'format': 'Pi', 'producerSessionId': run_id + '-' + document['id'], 'subagentId': None},
            'expectedRevision': 0, 'digest': sha, 'completion': 'Closed', 'redacted': False,
            'metadata': {'title': document['title'], 'project': 'relevance-' + run_id, 'workdir': None, 'gitRemote': None,
                         'gitBranch': None, 'gitCommit': None, 'producer': 'synthetic', 'model': None,
                         'startedAt': '2026-01-01T00:00:00Z', 'endedAt': None, 'tags': ['synthetic-relevance']},
            'messages': normalized, 'files': [{'path': 'synthetic.jsonl', 'sha256': sha, 'content': raw}]}


def read_messages(bridge, sid, view, principal):
    result = []; offset = 0
    while True:
        page = bridge.call('get_messages', dict(sessionId=sid, offset=offset, limit=100, **view), principal)
        if page['view'] != view or page['offset'] != offset:
            raise ValueError('content view or page offset changed')
        result.extend(page['messages']); offset += len(page['messages'])
        if offset == page['total']:
            return result
        if not page['messages'] or offset > page['total']:
            raise ValueError('non-progressing or inconsistent message page')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('ingest', 'preflight', 'baseline', 'call'))
    for name in ('manifest', 'fixture', 'out'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--catalog', type=Path)
    parser.add_argument('--task')
    parser.add_argument('--mode', required=True, choices=('lexical', 'semantic', 'hybrid'))
    parser.add_argument('--related-policy', required=True, choices=('allow', 'deny'))
    parser.add_argument('--principal', required=True)
    parser.add_argument('--request', type=Path, help='one allowlisted tool request; never evaluator oracle')
    args = parser.parse_args(); manifest = load(args.manifest); fixture = load(args.fixture)
    for field in ('profile', 'profileSha256', 'modelCatalogSha256', 'runId'):
        if not manifest[field]:
            raise ValueError('missing provenance: ' + field)
    args.out.mkdir(parents=True, exist_ok=False)
    safe = {key: manifest[key] for key in ('origin', 'pid', 'executable', 'elfSha256', 'profile', 'profileSha256', 'modelCatalogSha256', 'runId')}
    safe.update(fixtureSha256=digest(args.fixture), manifestSha256=digest(args.manifest), phase=args.phase, mode=args.mode, relatedPolicy=args.related_policy, principal=args.principal,
                blindness='UNESTABLISHED', budget={'calls': CALL_LIMIT, 'perCallBytes': CALL_BYTES, 'totalBytes': TOTAL_BYTES, 'seconds': TOTAL_SECONDS},
                sources={p.name: digest(p) for p in (ROOT / 'bridge.py', ROOT / 'evaluate.py')})
    save(args.out / 'attempt.json', safe)
    bridge = Bridge(manifest, args.out, args.task, args.phase == 'ingest',
                    search_mode=args.mode, related_policy=args.related_policy)
    try:
        identities = []
        for principal in (('reader', 'restricted') if args.phase == 'preflight' else (args.principal,)):
            user = bridge.call('whoami', {}, principal)['user']; identities.append(user['id'])
            if user['id'] != principal:
                raise ValueError('read credential principal mismatch')
            if user['scopes'] != ['Read']:
                raise ValueError('evaluation token must have exactly Read scope')
        if len(set(identities)) != len(identities):
            raise ValueError('reader and restricted principals must be distinct')
        if args.phase == 'ingest':
            receipts = {}
            for doc in fixture['documents']:
                payload = ingest_payload(doc, manifest['runId'])
                save(args.out / (doc['id'] + '.request.json'), payload)
                receipts[doc['id']] = bridge.post('/api/ingest', payload, doc['principal'], 'ingest', {'document': doc['id']})
                save(args.out / (doc['id'] + '.receipt.json'), receipts[doc['id']])
            save(args.out / 'receipts.json', receipts)
        elif args.phase == 'call':
            request = load(args.request)
            save(args.out / 'result.json', bridge.call(request['name'], request['arguments'], args.principal))
        else:
            catalog = load(args.catalog)
            if args.phase == 'preflight':
                published = {}
                for doc in fixture['documents']:
                    sid = catalog[doc['id']]['sessionId']
                    info = bridge.call('get_session', {'sessionId': sid}, doc['principal'])['session']
                    view = info['view']
                    if info['id'] != sid or not view['generationId'] or info['indexedRevision'] != catalog[doc['id']]['revision']:
                        raise ValueError('native publication not ready: ' + doc['id'])
                    actual = read_messages(bridge, sid, view, doc['principal'])
                    if [(m['id'], m['text']) for m in actual] != [(m['id'], m['text']) for m in messages(doc)]:
                        raise ValueError('normalized source differs: ' + doc['id'])
                    published[doc['id']] = {'sessionId': sid, 'view': view, 'principal': doc['principal'], 'jobId': catalog[doc['id']]['jobId']}
                save(args.out / 'catalog.json', dict(documents=published, indexCoverage=1.0,
                     fixtureSha256=digest(args.fixture), provenance=safe))
            else:
                if catalog['fixtureSha256'] != digest(args.fixture) or catalog['provenance']['manifestSha256'] != digest(args.manifest):
                    raise ValueError('catalog/fixture/owned-manifest hash mismatch')
                task = next(t for t in fixture['tasks'] if t['id'] == args.task)
                if 'principal' in task and task['principal'] != args.principal:
                    raise ValueError('task/explicit principal mismatch')
                result = bridge.call('search_sessions', {'query': task['query'], 'mode': args.mode, 'limit': 5, 'offset': 0,
                                     'project': 'relevance-' + manifest['runId']}, args.principal)
                for hit in result['hits']:
                    read_messages(bridge, hit['session']['id'], hit['session']['view'], args.principal)
                save(args.out / 'retrieval.json', result)
        save(args.out / 'outcome.json', {'status': 'Completed', 'calls': bridge.calls, 'bytes': bridge.bytes,
             'elapsedMs': round((time.monotonic() - bridge.started) * 1000, 3), 'claim': 'plumbing only; not answer correctness'})
    finally:
        bridge.close()


if __name__ == '__main__':
    main()
