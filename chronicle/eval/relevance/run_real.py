"""Explicitly bound, isolated, real-provider relevance matrix. Linux only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import random
import shutil
import secrets
import signal
import stat
import subprocess
import sys
import time
import uuid
from urllib.parse import urlsplit

from bridge import Bridge, loopback
from evaluate import ROOT, digest, facts_match, load, save, score_task
from runtime import Run, cleanup_adopted_children, enable_subreaper, finish, identity, listener_proof, port, terminate

MODES = ('lexical', 'semantic', 'hybrid')
FACT_FORMAT = 'ordered-string-values-v1'


def bound(binding):
    path = Path(binding['path']).resolve(strict=True)
    if re.fullmatch('[0-9a-f]{64}', binding['sha256']) is None or digest(path) != binding['sha256']:
        raise ValueError('bound input digest mismatch: ' + str(path))
    return path


def credential(path, policy):
    path = Path(path).resolve(strict=True)
    if stat.S_IMODE(path.stat().st_mode) != 0o600:
        raise ValueError('credential file must have mode 0600')
    value = path.read_text()
    if policy == 'token-free':
        if value != '':
            raise ValueError('token-free policy requires an exactly empty credential file')
    elif policy == 'bearer':
        if not value.strip() or '\n' in value.strip() or '\r' in value.strip():
            raise ValueError('bearer policy requires one nonempty credential')
    else:
        raise ValueError('explicit credential authPolicy required')
    return path


def validate_fixture(fixture, fact_format, split):
    if fact_format != FACT_FORMAT or fixture['factFormat'] != fact_format:
        raise ValueError('real runner requires declared ordered-string-values-v1')
    owners = {doc['principal'] for doc in fixture['documents']}
    if owners != {'reader', 'restricted'}:
        raise ValueError('controlled owner-only fixture requires reader/restricted owners')
    if len({doc['id'] for doc in fixture['documents']}) != len(fixture['documents']):
        raise ValueError('duplicate document identity')
    if len({task['id'] for task in fixture['tasks']}) != len(fixture['tasks']):
        raise ValueError('duplicate task identity')
    for task in fixture['tasks']:
        if task['principal'] not in owners or task['split'] not in ('dev', 'holdout'):
            raise ValueError('explicit known task principal and split required')
        facts_match(task, {'facts': task['facts']}, fact_format, normalization=fixture['factNormalization'])
    selected = [task for task in fixture['tasks'] if task['split'] == split]
    if not selected:
        raise ValueError('selected split contains no tasks')
    return selected


def matrix_seconds(tasks, modes, bootstrap_seconds, publication_seconds):
    if bootstrap_seconds <= 0 or publication_seconds <= 0 or not tasks or not modes:
        raise ValueError('positive phase budgets and nonempty matrix required')
    # Each persisted run may use its full server deadline, drain and RPC overhead.
    return bootstrap_seconds + publication_seconds + len(tasks) * len(modes) * (900 + 30 + 60)


def trial_schedule(fixture, modes, split):
    generator = random.Random(fixture['modeOrderSeed'])
    schedule = []
    for task in fixture['tasks']:
        order = list(modes); generator.shuffle(order)
        for mode in order:
            if task['split'] == split:
                schedule.append({'taskId': task['id'], 'mode': mode})
    return schedule


def verify_model_catalog(catalog, profiles, policy_identity):
    embedding = profiles['embedding']; annotation = profiles['annotation']
    expected_space = ['embedding-space-v1', hashlib.sha256(embedding['endpoint'].encode()).hexdigest(),
        embedding['model'], embedding['revision'], embedding['dimensions'], embedding['sendDimensions'],
        embedding['queryPrefix'], embedding['documentPrefix'], 'cosine']
    if len(catalog['spaces']) != 1 or catalog['spaces'][0]['descriptor'] != expected_space:
        raise ValueError('actual embedding descriptor differs from bound real profile')
    if len(catalog['profiles']) != 1:
        raise ValueError('exactly one declared index profile required')
    profile = catalog['profiles'][0]; descriptor = profile['descriptor']
    if descriptor[2] != policy_identity or profile['policy'] != 'ContextAwareProblemsV1':
        raise ValueError('actual annotation source policy identity mismatch')
    actual_annotation = descriptor[1]
    if actual_annotation[:3] != [hashlib.sha256(annotation['endpoint'].encode()).hexdigest(), annotation['model'], annotation['revision']] or actual_annotation[4] != str(annotation['maxResponseBytes']):
        raise ValueError('actual annotation descriptor differs from bound real profile')


def wait(run, label, seconds, inspect):
    deadline = time.monotonic() + run.remaining(seconds)
    while time.monotonic() < deadline:
        if inspect():
            return
        time.sleep(.2)
    raise TimeoutError(label)


def trace(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def read_evaluation_trace(path, outcome):
    failure = outcome['failure']
    if failure is not None and failure['type'] == 'trace-normalization-failed':
        return [], {'type': 'trace-normalization-failed', 'message': failure['message']}
    if not outcome['traceComplete']:
        return [], {'type': 'incomplete-trace', 'message': 'validated complete original trace unavailable'}
    try:
        return trace(path), None
    except (OSError, ValueError) as error:
        return [], {'type': type(error).__name__, 'message': str(error)}


def freeze(bindings, directory):
    archive = directory / 'frozen'; archive.mkdir()
    sources = []
    for number, binding in enumerate(bindings['frozenInputs']):
        source = bound(binding)
        target = archive / f'{number:04d}-{source.name}'
        target.write_bytes(source.read_bytes()); target.chmod(0o400)
        if digest(target) != binding['sha256']:
            raise ValueError('frozen input changed during snapshot')
        sources.append({'path': str(source), 'sha256': binding['sha256'], 'saved': target.name})
    save(archive / 'index.json', sources)
    required = {str((ROOT / name).resolve()) for name in (
        'run_real.py', 'runtime.py', 'bridge.py', 'evaluate.py', 'agent_probe.mjs', 'live_protocol.mjs', 'resolve-live-generated.mjs')}
    required.update(str(bound(bindings[key])) for key in ('fixture', 'configTemplate', 'embeddingProof'))
    required.update(str(bound(bindings[key]['profile'])) for key in ('annotation', 'embedding'))
    if not required.issubset({item['path'] for item in sources}):
        raise ValueError('frozenInputs must include all workflow/fixture/config/profile inputs')
    workflow = directory / 'workflow'; workflow.mkdir()
    for source in sources:
        if source['path'] in required:
            target = workflow / Path(source['path']).name
            if target.exists():
                raise ValueError('frozen workflow input basename collision')
            target.write_bytes((archive / source['saved']).read_bytes()); target.chmod(0o400)
    project = directory / 'codec-project'; project.mkdir()
    root = Path(bindings['generatedProject']).resolve(strict=True)
    files = bindings['generatedFiles']
    actual = {str(p.relative_to(root)) for p in (root / 'generated/typescript').rglob('*.ts')}
    if actual != {entry['relativePath'] for entry in files}:
        raise ValueError('generatedFiles must bind every generated TypeScript source')
    for entry in files:
        relative = Path(entry['relativePath'])
        if relative.is_absolute() or '..' in relative.parts or not str(relative).startswith('generated/typescript/'):
            raise ValueError('generated source path escapes codec project')
        source = bound({'path': str(root / relative), 'sha256': entry['sha256']})
        target = project / relative; target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes()); target.chmod(0o400)
        if digest(target) != entry['sha256']:
            raise ValueError('generated input changed during snapshot')
    return workflow, project


def fingerprint(sql):
    # Published retrieval state only; no jobs, leases, telemetry, browser sessions or clocks.
    tables = {'sources': ('ch_sources', 'id'), 'generations': ('ch_generations', 'id'),
              'chunks': ('ch_chunks', 'id'), 'searchChunks': ('ch_search_chunks', 'id'),
              'profiles': ('ch_index_profiles', 'profile'), 'spaces': ('ch_embedding_spaces', 'id'),
              'jobs': ('ch_jobs', 'id'),
              'revisions': ('ch_revisions', 'session_id,revision'), 'revisionInfo': ('ch_revision_info', 'session_id,revision'),
              'messages': ('ch_messages', 'session_id,revision,position'), 'passages': ('ch_problem_passages', 'generation,ordinal'),
              'problemSpans': ('ch_problem_spans', 'generation,passage_id,ordinal'),
              'contextSpans': ('ch_context_spans', 'generation,ordinal'), 'pieces': ('ch_problem_pieces', 'generation,piece_ordinal'),
              'ownerTargets': ('ch_owner_targets', 'owner'), 'generationTags': ('ch_generation_tags', 'generation,tag')}
    state = {}
    for label, (table, order) in tables.items():
        columns = 'id,session_id,revision,profile,state,run_id' if label == 'jobs' else '*'
        state[label] = json.loads(sql(f"SELECT COALESCE(json_agg(row_to_json(t) ORDER BY {order}),'[]') FROM (SELECT {columns} FROM {table}) t;"))
    canonical = json.dumps(state, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    return {'sha256': hashlib.sha256(canonical.encode()).hexdigest(), 'state': state}


def data_inventory(directory):
    if (directory / 'postmaster.pid').exists():
        raise ValueError('prepared PGDATA must be stopped')
    result = {'.': {'type': 'directory', 'mode': stat.S_IMODE(directory.stat().st_mode)}}
    for path in sorted(directory.rglob('*')):
        if path.is_symlink():
            raise ValueError('prepared PGDATA symlinks forbidden')
        relative = str(path.relative_to(directory)); mode = stat.S_IMODE(path.stat().st_mode)
        if path.is_file():
            result[relative] = {'type': 'file', 'mode': mode, 'sha256': digest(path)}
        elif path.is_dir():
            result[relative] = {'type': 'directory', 'mode': mode}
        else:
            raise ValueError('unsupported prepared filesystem entry')
    if len(result) == 1:
        raise ValueError('empty prepared PGDATA')
    return result


def validate_execution_bindings(bindings, phase):
    if 'preparedNative' not in bindings:
        raise ValueError('required preparedNative binding missing')
    publisher = bindings['preparedNative']
    if phase == 'prepare':
        if publisher is not None:
            raise ValueError('prepare requires preparedNative null')
    elif phase == 'run':
        if not isinstance(publisher, dict) or set(publisher) != {'path', 'sha256'}:
            raise ValueError('run requires explicit preparedNative path/hash binding')
        if type(publisher['path']) is not str or not publisher['path'] or type(publisher['sha256']) is not str or re.fullmatch('[0-9a-f]{64}', publisher['sha256']) is None:
            raise ValueError('invalid preparedNative path/hash binding')
    else:
        raise ValueError('unknown execution phase')
    for name in ('agentReasoningPolicy', 'agentMaximumOutputTokens', 'agentRevision'):
        if name not in bindings:
            raise ValueError('required agent binding missing: ' + name)
    if bindings['agentReasoningPolicy'] not in ('high', 'max'):
        raise ValueError('agentReasoningPolicy must be explicit high or max')
    if type(bindings['agentMaximumOutputTokens']) is not int or bindings['agentMaximumOutputTokens'] <= 0:
        raise ValueError('agentMaximumOutputTokens must be a positive integer')
    revision = bindings['agentRevision']
    if type(revision) is not str or not revision or revision != revision.strip():
        raise ValueError('agentRevision must be an explicit nonempty revision')


def clone_prepared(prepared, directory, bindings):
    if directory == prepared or directory.is_relative_to(prepared) or prepared.is_relative_to(directory):
        raise ValueError('output must be disjoint from prepared seed')
    proof = load(prepared / 'prepared.json')
    cleanup = load(prepared / 'cleanup.json')
    for name, expected in proof['preparedFiles'].items():
        if digest(prepared / name) != expected:
            raise ValueError('prepared metadata changed: ' + name)
    if proof['status'] != 'Prepared' or not cleanup['ownedChildrenReaped'] or cleanup['cleanupErrors']:
        raise ValueError('prepared publication lacks successful stopped cleanup')
    prior = load(prepared / 'bindings.json')
    if 'preparedNative' not in bindings or prior['native'] != bindings['preparedNative']:
        raise ValueError('prepared publisher native binding differs')
    bound(bindings['preparedNative'])
    for name in ('postgres', 'fixture', 'annotation', 'embedding', 'factFormat', 'agentModel', 'generatedFiles', 'configTemplate'):
        if prior[name] != bindings[name]:
            raise ValueError('prepared binding differs: ' + name)
    before = data_inventory(prepared / 'data')
    if before != proof['dataFiles']:
        raise ValueError('prepared PGDATA changed')
    shutil.copytree(prepared / 'data', directory / 'data', copy_function=shutil.copy2)
    if data_inventory(directory / 'data') != before or data_inventory(prepared / 'data') != before:
        raise ValueError('offline PGDATA copy or immutable source verification failed')
    for name in ('database-password', 'browser-password', 'password-hash', 'reader-read', 'reader-ingest', 'restricted-read', 'restricted-ingest'):
        source = prepared / name
        if stat.S_IMODE(source.stat().st_mode) != 0o600:
            raise ValueError('prepared credential permissions changed')
        shutil.copy2(source, directory / name)
        if source.read_bytes() != (directory / name).read_bytes():
            raise ValueError('private credential copy differs')
    return proof


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bindings', type=Path, required=True)
    parser.add_argument('--bindings-sha256', required=True)
    parser.add_argument('--split', choices=('dev', 'holdout'))
    parser.add_argument('--phase', choices=('prepare', 'run'), required=True)
    parser.add_argument('--prepared', type=Path)
    parser.add_argument('--prepared-sha256')
    args = parser.parse_args(); os.umask(0o077)
    signal.signal(signal.SIGTERM, terminate)
    if digest(args.bindings) != args.bindings_sha256:
        raise ValueError('bindings digest mismatch')
    bindings = load(args.bindings)
    validate_execution_bindings(bindings, args.phase)
    publication_native = bindings['native'] if args.phase == 'prepare' else bindings['preparedNative']
    if bindings['version'] != 1 or bindings['relatedPolicy'] != 'deny':
        raise ValueError('version 1 comparison requires relatedPolicy deny')
    modes = bindings['modes']
    if not modes or len(modes) != len(set(modes)) or any(mode not in MODES for mode in modes):
        raise ValueError('explicit distinct lexical/semantic/hybrid modes required')
    fixture_path = bound(bindings['fixture']); fixture = load(fixture_path)
    if args.phase == 'run' and (args.split is None or args.prepared is None or args.prepared_sha256 is None):
        parser.error('run requires --prepared, --prepared-sha256 and explicit --split')
    if args.phase == 'run' and digest(args.prepared / 'prepared.json') != args.prepared_sha256:
        raise ValueError('prepared proof hash mismatch')
    if args.phase == 'prepare' and (args.prepared is not None or args.split is not None or args.prepared_sha256 is not None):
        parser.error('prepare accepts neither --prepared nor --split')
    tasks = validate_fixture(fixture, bindings['factFormat'], args.split if args.phase == 'run' else 'dev')
    if os.geteuid() == 0:
        raise ValueError('non-root PostgreSQL operator required')
    tools = {name: bound(bindings[name]) for name in ('native', 'python', 'node', 'chromium', 'playwright')}
    pg = {name: bound(binding) for name, binding in bindings['postgres']['tools'].items()}
    pg_exe = bound(bindings['postgres']['executable'])
    if bindings['postgres']['launcher'] is not None:
        bound(bindings['postgres']['launcher'])
    for path in [tools['native'], pg_exe]:
        with path.open('rb') as stream:
            if stream.read(4) != b'\x7fELF':
                raise ValueError('actual native/PostgreSQL ELF bindings required')
    for item in bindings['runtimeFiles']:
        bound(item)
    profiles = {}; credentials = {}
    for purpose in ('annotation', 'embedding'):
        spec = bindings[purpose]; profiles[purpose] = load(bound(spec['profile']))
        if 'credentialFile' in profiles[purpose]:
            raise ValueError('profile must not embed credential file or bytes')
        credentials[purpose] = credential(spec['credentialFile'], spec['authPolicy'])
        endpoint = urlsplit(profiles[purpose]['endpoint'])
        if endpoint.username or endpoint.password or endpoint.fragment or endpoint.query:
            raise ValueError('provider endpoint must not embed credentials/query/fragment')
        if spec['authPolicy'] == 'token-free':
            loopback(endpoint.scheme + '://' + endpoint.netloc)
        elif endpoint.scheme != 'https':
            raise ValueError('bearer provider requires explicit HTTPS endpoint')
        if spec['ownership'] != 'external-nonowned':
            raise ValueError('real providers must be external-nonowned')
    directory = Path(bindings['out']).resolve()
    if args.prepared is not None:
        prepared = args.prepared.resolve(strict=True)
        if directory == prepared or directory.is_relative_to(prepared) or prepared.is_relative_to(directory):
            raise ValueError('output must be disjoint from prepared seed')
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    workflow, codec_project = freeze(bindings, directory)
    fixture_path = workflow / fixture_path.name
    save(directory / 'bindings.json', bindings)
    seconds = matrix_seconds(tasks, modes, bindings['bootstrapSeconds'], bindings['publicationSeconds'])
    save(directory / 'budget.json', {'matrixSeconds': seconds, 'perRunSeconds': 900, 'selectedTasks': len(tasks),
         'modes': modes, 'split': args.split, 'financialCap': None})
    environment = {'PATH': str(pg['postgres'].parent) + ':/usr/bin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8',
                   'LIVE_CODEC_PROJECT': str(codec_project)}
    if set(bindings['environment']) - {'FONTCONFIG_FILE', 'PLAYWRIGHT_BROWSERS_PATH', 'SSL_CERT_FILE'}:
        raise ValueError('only explicitly bound font/browser/TLS environment allowed')
    environment.update(bindings['environment'])
    if any('TOKEN' in key or 'KEY' in key or 'PASSWORD' in key or 'PROXY' in key.upper() for key in environment):
        raise ValueError('credentials/proxies forbidden in child environment')
    enable_subreaper(); run = Run(directory, environment, seconds)
    failure = None; summary = None; final_exit = 1
    try:
        if args.phase == 'run':
            prepared = args.prepared.resolve(strict=True)
            seed = clone_prepared(prepared, directory, bindings)
        else:
            for name in ('database-password', 'browser-password', 'reader-read', 'reader-ingest', 'restricted-read', 'restricted-ingest'):
                target = directory / name; target.write_text(secrets.token_urlsafe(48)); target.chmod(0o600)
            hashed = subprocess.run([str(tools['native']), 'password-hash'], input=(directory / 'browser-password').read_text() + '\n',
                capture_output=True, text=True, cwd=directory, env=run.env, timeout=run.remaining(30))
            save(directory / 'password-hash-exit.json', {'exit': hashed.returncode})
            if hashed.returncode != 0 or not hashed.stdout.strip():
                raise RuntimeError('synthetic browser password hashing failed')
            (directory / 'password-hash').write_text(hashed.stdout.strip())
            run.command('initdb', [str(pg['initdb']), '-D', str(directory / 'data'), '-U', 'postgres', '--auth-local=trust',
                        '--auth-host=scram-sha-256', '--pwfile=' + str(directory / 'database-password'), '--no-locale', '--encoding=UTF8'])
        dbport = port(); appport = port()
        while appport == dbport:
            appport = port()
        postgres = run.start('postgres', [str(pg['postgres']), '-D', str(directory / 'data'), '-h', '127.0.0.1', '-p', str(dbport), '-k', ''])
        def pg_owned():
            return identity(postgres, pg_exe, bindings['postgres']['executable']['sha256'], dbport, bindings['postgres']['launcher'])
        def database_ready():
            if not pg_owned():
                return False
            result = subprocess.run([str(pg['pg_isready']), '-h', '127.0.0.1', '-p', str(dbport), '-U', 'postgres'],
                env=run.env, cwd=directory, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=run.remaining(3))
            return result.returncode == 0
        wait(run, 'owned PostgreSQL readiness', bindings['bootstrapSeconds'], database_ready)
        save(directory / 'postgres-listener-proof.json', listener_proof(postgres, pg_exe, bindings['postgres']['executable']['sha256'], dbport))
        def sql(statement):
            if not pg_owned():
                raise RuntimeError('PostgreSQL ownership lost')
            pidfile = (directory / 'data/postmaster.pid').read_text().splitlines()
            if int(pidfile[0]) != postgres.pid or Path(pidfile[1]).resolve() != directory / 'data' or int(pidfile[3]) != dbport:
                raise RuntimeError('PostgreSQL PID/data/port mismatch')
            env = dict(run.env, PGPASSWORD=(directory / 'database-password').read_text())
            result = subprocess.run([str(pg['psql']), '-X', '-qAt', '-h', '127.0.0.1', '-p', str(dbport), '-U', 'postgres',
                '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], input="SET statement_timeout='5s';\n" + statement,
                text=True, capture_output=True, env=env, cwd=directory, timeout=run.remaining(8))
            if result.returncode != 0:
                raise RuntimeError('owned SQL failed: ' + result.stderr)
            return result.stdout.strip()
        if sql("SELECT current_setting('server_version_num');") != bindings['postgres']['versionNumber']:
            raise ValueError('PostgreSQL version binding mismatch')
        origin = f'http://127.0.0.1:{appport}'
        run_id = load(prepared / 'owned.json')['runId'] if args.phase == 'run' else uuid.uuid4().hex
        config = load(prepared / 'config.json') if args.phase == 'run' else load(workflow / Path(bindings['configTemplate']['path']).name)
        config.update(listenHost='127.0.0.1', listenPort=appport, allowedOrigin=origin,
            jdbcUrl=f'jdbc:postgresql://127.0.0.1:{dbport}/postgres', databaseUser='postgres', databasePasswordFile=str(directory / 'database-password'),
            users=[{'id': owner, 'login': owner, 'passwordHashFile': str(directory / 'password-hash'), 'enabled': True} for owner in ('reader', 'restricted')],
            staticTokens=[{'id': str(uuid.uuid4()), 'userId': owner, 'name': 'evaluation-' + scope, 'scopes': ['Read' if scope == 'read' else 'Ingest'],
                'tokenFile': str(directory / (owner + '-' + scope))} for owner in ('reader', 'restricted') for scope in ('read', 'ingest')],
            indexing={'annotationSessions': 1, 'embeddingRequests': 1, 'embeddingBatchSize': 16})
        if args.phase == 'run':
            config['staticTokens'] = load(prepared / 'config.json')['staticTokens']
            for token in config['staticTokens']:
                scope = 'read' if token['scopes'] == ['Read'] else 'ingest'
                token['tokenFile'] = str(directory / (token['userId'] + '-' + scope))
        for purpose in profiles:
            config[purpose] = dict(profiles[purpose], credentialFile=str(credentials[purpose]))
        save(directory / 'config.json', config); save(directory / 'profile.json', profiles)
        native = run.start('native', [str(tools['native']), 'serve', str(directory / 'config.json')])
        wait(run, 'owned native listener', bindings['bootstrapSeconds'], lambda: identity(native, tools['native'], bindings['native']['sha256'], appport, None))
        save(directory / 'native-listener-proof.json', listener_proof(native, tools['native'], bindings['native']['sha256'], appport))
        model_catalog = json.loads(sql("SELECT json_build_object('profiles',(SELECT json_agg(row_to_json(p)) FROM ch_index_profiles p),'spaces',(SELECT json_agg(row_to_json(e)) FROM ch_embedding_spaces e));"))
        if not model_catalog['profiles'] or not model_catalog['spaces']:
            raise ValueError('runtime model/profile catalog missing')
        verify_model_catalog(model_catalog, profiles, bindings['expectedPolicyIdentity'])
        save(directory / 'model-catalog.json', model_catalog)
        manifest = {'origin': origin, 'pid': native.pid, 'executable': str(tools['native']), 'elfSha256': bindings['native']['sha256'], 'runId': run_id,
            'publicationNative': publication_native, 'executorNative': bindings['native'],
            'profile': profiles, 'profileSha256': digest(directory / 'profile.json'), 'modelCatalogSha256': digest(directory / 'model-catalog.json'),
            'tokenFiles': {owner: str(directory / (owner + '-read')) for owner in ('reader', 'restricted')},
            'ingestTokenFiles': {owner: str(directory / (owner + '-ingest')) for owner in ('reader', 'restricted')}}
        save(directory / 'owned.json', manifest)
        common = ['--manifest', str(directory / 'owned.json'), '--fixture', str(fixture_path), '--related-policy', 'deny']
        bridge = [str(tools['python']), str(workflow / 'bridge.py')]
        if args.phase == 'prepare':
            run.command('ingest', bridge + ['ingest', *common, '--mode', modes[0], '--principal', 'reader', '--out', str(directory / 'ingest')])
            receipts = load(directory / 'ingest/receipts.json')
            ids = ','.join("'" + str(uuid.UUID(receipt['jobId'])) + "'" for receipt in receipts.values())
            last_jobs = []
            def published():
                nonlocal last_jobs
                last_jobs = json.loads(sql(f"SELECT COALESCE(json_agg(json_build_object('id',id,'state',state,'error',error,'failureStage',failure_stage)),'[]') FROM ch_jobs WHERE id IN ({ids});"))
                if any(row['state'] == 'Failed' for row in last_jobs):
                    raise RuntimeError('real indexing failed; no fallback')
                return len(last_jobs) == len(receipts) and all(row['state'] == 'Complete' for row in last_jobs)
            try:
                wait(run, 'real source publication', bindings['publicationSeconds'], published)
            finally:
                save(directory / 'observed-index-jobs.json', last_jobs)
        else:
            (directory / 'ingest').mkdir()
            shutil.copy2(prepared / 'ingest/receipts.json', directory / 'ingest/receipts.json')
        run.command('preflight', bridge + ['preflight', *common, '--mode', modes[0], '--principal', 'reader', '--catalog',
                    str(directory / 'ingest/receipts.json'), '--out', str(directory / 'preflight')])
        catalog_path = directory / 'preflight/catalog.json'; catalog = load(catalog_path)
        initial = fingerprint(sql); save(directory / 'publication-before.json', initial)
        if args.phase == 'run' and initial['sha256'] != seed['publicationSha256']:
            raise ValueError('cloned publication generations/profiles/vectors/jobs differ')
        if args.phase == 'run':
            results = []; controller_exits = []
            schedule = trial_schedule(fixture, modes, args.split)
            save(directory / 'schedule.json', {'seed': fixture['modeOrderSeed'], 'trials': schedule})
            for cell in schedule:
                mode = cell['mode']; task = next(t for t in tasks if t['id'] == cell['taskId'])
                principal = task['principal']; selected = [task]
                output = directory / ('baseline-' + mode + '-' + task['id'])
                run.command(output.name, bridge + ['baseline', *common, '--mode', mode, '--principal', task['principal'],
                    '--catalog', str(catalog_path), '--task', task['id'], '--out', str(output)])
                agent = directory / ('agent-' + mode + '-' + task['id']); agent.mkdir()
                mapping = {str(uuid.uuid4()): task['id'] for task in selected}
                save(agent / 'evaluator-private-map.json', mapping)
                projected = [{'id': opaque, 'question': next(t['question'] for t in selected if t['id'] == actual)} for opaque, actual in mapping.items()]
                probe_input = {'origin': origin, 'project': 'relevance-' + run_id, 'passwordFile': str(directory / 'browser-password'),
                    'playwright': str(tools['playwright']), 'chromium': str(tools['chromium']), 'tasks': projected, 'login': principal,
                    'mode': mode, 'relatedPolicy': 'deny', 'factFormat': FACT_FORMAT, 'agentModel': bindings['agentModel'],
                    'agentReasoningPolicy': bindings['agentReasoningPolicy'], 'agentMaximumOutputTokens': bindings['agentMaximumOutputTokens'],
                    'agentRevision': bindings['agentRevision']}
                save(agent / 'input.json', probe_input)
                client = run.start(agent.name, [str(tools['node']), '--experimental-transform-types', '--import', str(workflow / 'resolve-live-generated.mjs'),
                    str(workflow / 'agent_probe.mjs'), str(codec_project), str(agent / 'input.json'), str(agent)])
                try:
                    client_exit = client.wait(run.remaining(len(selected) * 930 + 60))
                finally:
                    run.stop(run.children[-1])
                save(agent / 'client-exit.json', {'exit': client_exit})
                controller_exits.append({'group': agent.name, 'exit': client_exit})
                for opaque, actual in mapping.items():
                    task = next(t for t in selected if t['id'] == actual); output = agent / opaque
                    output.mkdir(exist_ok=True)
                    outcome_path = output / 'outcome.json'; trace_path = output / 'trace.jsonl'
                    outcome = load(outcome_path) if outcome_path.exists() else {
                        'state': 'NotObserved', 'traceComplete': False, 'failure': {'type': 'missing-controller-outcome', 'clientExit': client_exit}, 'conditionViolations': 0}
                    observed, trace_failure = read_evaluation_trace(trace_path, outcome)
                    if any(event['taskId'] != opaque for event in observed):
                        raise ValueError('trace opaque identity mismatch')
                    answer_path = output / 'answer.json'
                    if answer_path.exists():
                        original = load(answer_path)
                        if original['taskId'] != opaque:
                            raise ValueError('answer opaque identity mismatch before projection')
                        answer = dict(original, taskId=actual)
                    else:
                        answer = {'taskId': actual, 'facts': {'values': []}, 'abstain': False, 'citations': []}
                    result = score_task(fixture, catalog['documents'], task, answer,
                        [dict(event, taskId=actual) for event in observed], 5, principal=principal, fact_format=FACT_FORMAT)
                    if trace_failure is not None:
                        result.update(recallAtK=None, mrr=None, retrievalExercised=None, aclLeak=None,
                            citationValidity=None, evidenceCoverage=None, retrievalMetricsUnavailable=trace_failure)
                    if trace_failure is not None or not answer_path.exists() or outcome['state'] != 'Complete' or outcome['failure'] is not None or outcome['conditionViolations'] :
                        result['answerSuccess'] = False
                    result.update(mode=mode, principal=principal, execution=outcome, originalAnswerSha256=digest(answer_path) if answer_path.exists() else None,
                        identityProjection={'from': opaque, 'to': actual}, fixtureSha256=digest(fixture_path), catalogSha256=digest(catalog_path))
                    save(output / 'score.json', result); results.append(result)
                current = fingerprint(sql); save(directory / ('publication-after-' + mode + '-' + task['id'] + '.json'), current)
                if current['sha256'] != initial['sha256']:
                    raise ValueError('published generations/profiles/vectors changed during comparison')
        for item in bindings['frozenInputs'] + bindings['runtimeFiles'] + [bindings[name] for name in tools]:
            bound(item)
        if args.phase == 'prepare':
            summary = {'status': 'Prepared', 'publicationSha256': initial['sha256'], 'fixtureSha256': digest(fixture_path)}
            final_exit = 0
        else:
            summary = {'status': 'Completed' if all(r['answerSuccess'] for r in results) and all(c['exit'] == 0 for c in controller_exits) else 'CompletedWithFailures',
                'split': args.split, 'modes': modes, 'controllers': controller_exits, 'publicationSha256': initial['sha256'], 'tasks': results,
                'claim': 'real annotation and external real embeddings; tools-only agent; same publication across declared modes',
                'aclOracle': 'owner-only synthetic corpus, not general group-sharing authorization'}
            final_exit = 0 if summary['status'] == 'Completed' else 2
        summary.update(publicationNative=publication_native, executorNative=bindings['native'])
    except BaseException as error:
        failure = {'type': type(error).__name__, 'message': str(error)}
        if isinstance(error, (TimeoutError, subprocess.TimeoutExpired)):
            failure['classification'] = 'incomplete-experiment-not-product-verdict'
        raise
    finally:
        finish(run, directory, failure, summary, cleanup_adopted_children)
    if args.phase == 'prepare':
        pg_exit = next(item for item in run.exits if item['name'] == 'postgres')
        if pg_exit['exit'] != 0 or pg_exit['forced']:
            raise RuntimeError('prepared PostgreSQL did not shut down cleanly')
        control = subprocess.run([str(pg['pg_controldata']), str(directory / 'data')], text=True, capture_output=True,
            env=run.env, cwd=directory, timeout=10)
        (directory / 'pg-controldata.txt').write_text(control.stdout)
        if control.returncode != 0 or re.search(r'^Database cluster state:\s+shut down$', control.stdout, re.M) is None:
            raise RuntimeError('prepared PostgreSQL control state is not shut down')
        save(directory / 'prepared.json', dict(summary, dataFiles=data_inventory(directory / 'data'),
            preparedFiles={name: digest(directory / name) for name in ('bindings.json', 'config.json', 'profile.json', 'model-catalog.json',
                'owned.json', 'ingest/receipts.json', 'preflight/catalog.json', 'publication-before.json', 'cleanup.json', 'pg-controldata.txt')}))
    elif data_inventory(prepared / 'data') != seed['dataFiles']:
        raise ValueError('immutable prepared seed changed during run')
    save(directory / 'summary.json', summary)
    return final_exit


if __name__ == '__main__':
    sys.exit(main())
