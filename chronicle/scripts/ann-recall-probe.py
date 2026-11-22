#!/usr/bin/env python3
"""Read-only probe of Chronicle search's ANN leg: recall@10 and recall@100 of the product's semantic (HNSW) leg against an
exact scan of the same visible rows, for one reader, in one READ ONLY REPEATABLE READ transaction. See
ann-recall-probe.md (what it measures, how to run it before and after a deployment, the comparison rule).

  ann-recall-probe.py measure --reader USER [--queries 200] [--seed 20261122] --out BASELINE.json ...
  ann-recall-probe.py measure --reader USER --queries-from BASELINE.json --out AFTER.json ...
  ann-recall-probe.py compare BASELINE.json AFTER.json

The connection is libpq's: PGHOST, PGPORT, PGDATABASE, PGUSER and a password file or service (`--dsn` instead); the probe
never reads or prints credentials. It writes nothing to the database and makes no model call: its query vectors are
stored vectors of the reader's visible rows, sampled with a fixed seed by the baseline run, which saves them in its output
file; the after run reuses exactly those (--queries-from)."""
import argparse, collections, hashlib, json, os, random, re, subprocess, sys, tempfile, time

PROBE_VERSION = 4
GATE_MIN_QUERIES = 200

KS = (10, 100)
CANDIDATES_PER_LEG = 1000  # CandidatePolicy.candidatesPerLeg
# CandidateSql.configureStatements (SearchPolicy.configure) and the first pass's scan budget (SemanticLegBudget.production
# firstScanTuples = CandidatePolicy.maxScanTuples): identical before and after L5.
ANN_SETTINGS = ('hnsw.iterative_scan', 'strict_order'), ('hnsw.ef_search', '200'), ('hnsw.max_scan_tuples', '200000'), ('hnsw.scan_mem_multiplier', '4')
EXECUTABLE_POLICIES = "'ContextAwareProblemsV1'"  # IndexProfiles.executablePolicies (IndexPolicy.values)
# Database.visible (the same text before and after L5); `{reader}` a quoted literal.
VISIBLE = ("EXISTS(SELECT 1 FROM ch_users ou WHERE ou.id=s.owner AND ou.enabled) AND EXISTS(SELECT 1 FROM ch_users ru WHERE ru.id={reader} AND ru.enabled) "
           "AND (s.owner={reader} OR EXISTS(SELECT 1 FROM ch_members a JOIN ch_members b ON a.group_id=b.group_id WHERE a.user_id={reader} AND b.user_id=s.owner)) "
           "AND NOT s.tombstone")
COMPATIBLE = ("EXISTS(SELECT compatible.embedding_space FROM ch_index_profiles compatible WHERE compatible.profile=ch.profile "
              f"AND compatible.policy IN({EXECUTABLE_POLICIES}) AND compatible.embedding_space={{space}} OFFSET 0)")  # IndexProfiles.compatibleSql
# The search row `ch` is a piece of its session's published generation: before L5 (62714e81 Search.statement
# `authorized`) a row of that generation itself; from L5 on (GenerationRows.publishedInfo) also a retained row of an
# origin inside one of the published lineage version's piece segments.
PUBLISHED_INFO = {
    'pre-l5': "SELECT r0.metadata FROM ch_revision_info r0 WHERE r0.session_id=s.id AND r0.revision=ch.revision AND s.published=ch.generation",
    'l5': ("SELECT own.metadata FROM ch_revision_info own WHERE s.published=ch.generation AND own.session_id=s.id AND own.revision=ch.revision "
           "UNION ALL SELECT held.metadata FROM ch_generations p JOIN ch_revision_info held ON held.session_id=s.id AND held.revision=p.revision "
           "WHERE p.id=s.published AND s.published<>ch.generation AND (s.published=ch.generation OR (SELECT true FROM ch_lineage_segments held_m "
           "WHERE held_m.lineage=p.lineage AND held_m.origin=ch.generation AND held_m.since<=p.lineage_version AND (held_m.until IS NULL OR held_m.until>p.lineage_version) "
           "AND held_m.kind='piece' AND ch.ordinal>=held_m.lo AND ch.ordinal<held_m.hi LIMIT 1))")}
# The product's fields of the leg (Search.statement `fields`).
FIELDS = {'pre-l5': 'ch.id,ch.generation,ch.session_id,ch.revision,ch.document,ch.embedding',
          'l5': 'ch.id,ch.generation,ch.session_id,ch.revision,ch.ordinal,ch.document,ch.embedding'}
# The product's order of equal distances (CandidateSql.rerankCtes and LegPass.Exact): before L5 (4dfd4f48) the row id; from
# L5 on SearchPolicy.tieBreak (session_id, ordinal, id; ascending, NULLs last).
TIE_BREAK = {'pre-l5': ('id',), 'l5': ('session_id', 'ordinal', 'id')}
# The pairs of schema variants a comparison accepts (baseline, after): the same variant, or the L5 deployment between them.
SCHEMA_PAIRS = {('pre-l5', 'pre-l5'), ('l5', 'l5'), ('pre-l5', 'l5')}


def tie_columns(schema, alias):
    return ''.join(f', {alias}{column}' for column in TIE_BREAK[schema])


def ranked(rows, schema):
    """(row id, distance) of rows (id, distance, *tie-break columns as text) in the product's order: distance, then the
    tie-break columns (uuid text orders as PostgreSQL's uuid does; ordinals numerically, NULLs last)."""
    def key(row):
        ties = []
        for column, value in zip(TIE_BREAK[schema], row[2:]):
            ties.append((value == '', int(value) if value and column == 'ordinal' else value))
        return (row[1], *ties)
    return [(row[0], row[1]) for row in sorted(rows, key=key)]


def ann_sql(schema, dims, reader, space, vector):
    """The semantic leg's first pass (LegPass.Index) as Search.statement builds it — `authorized` per row inside the
    ordered index scan (OFFSET 0), the profile compatible with the configured space, ordered by CandidateSql.annDistance,
    LIMIT candidatesPerLeg — and each candidate's original-vector distance (what the product reranks by)."""
    authorized = f"(SELECT true FROM ch_sources s CROSS JOIN LATERAL({PUBLISHED_INFO[schema]}) r WHERE s.id=ch.session_id AND {VISIBLE.format(reader=reader)} OFFSET 0)"
    if schema == 'pre-l5':  # 62714e81: the revision join and the published generation in the subquery itself
        authorized = (f"(SELECT true FROM ch_sources s JOIN ch_revision_info r ON r.session_id=s.id AND r.revision=ch.revision WHERE s.id=ch.session_id "
                      f"AND s.published=ch.generation AND {VISIBLE.format(reader=reader)} OFFSET 0)")
    return (f"WITH ann AS MATERIALIZED(SELECT {FIELDS[schema]} FROM ch_search_chunks ch WHERE vector_dims(ch.embedding)={dims} AND {COMPATIBLE.format(space=space)} "
            f"AND {authorized} ORDER BY l2_normalize(ch.embedding)::halfvec({dims}) <=> l2_normalize('{vector}'::vector)::halfvec({dims}) LIMIT {CANDIDATES_PER_LEG}) "
            f"SELECT 'ann', id, embedding <=> '{vector}'::vector{tie_columns(schema, '')} FROM ann")


def visible_rows(schema, dims, reader, space):
    """The leg's visible set from the source side (L5: Search.visibleChunks; before: the same rows as `authorized`)."""
    return (f"ch_sources s JOIN ch_search_chunks ch ON ch.session_id=s.id CROSS JOIN LATERAL({PUBLISHED_INFO[schema]}) r "
            f"WHERE {VISIBLE.format(reader=reader)} AND {COMPATIBLE.format(space=space)} AND vector_dims(ch.embedding)={dims}")


def literal(text):
    return "'" + text.replace("'", "''") + "'"


class Aborted(Exception):
    """A budget was reached: the transaction is rolled back and nothing is reported as a measurement."""


class Session:
    """One psql connection driven statement by statement (one transaction across the probe's statements). Inside the
    transaction (`bounded`) every statement runs with statement_timeout = min(the configured one, the time left of the
    budget); none starts once the budget is gone."""
    def __init__(self, dsn, deadline, statement_seconds):
        self.deadline, self.statement_seconds, self.bounded = deadline, statement_seconds, False
        self.sentinel, self.count = 'probe-end-' + os.urandom(8).hex(), 0
        self.errors = tempfile.TemporaryFile(mode='w+')
        self.process = subprocess.Popen(['psql', '-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1'] + ([dsn] if dsn else []),
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.errors, text=True, bufsize=1)

    def run(self, statement):
        left = self.deadline - time.monotonic()
        if left <= 0.5:
            raise Aborted('time budget reached')
        self.count += 1
        marker = f'{self.sentinel}-{self.count}'
        limit = f"SET LOCAL statement_timeout = '{int(min(self.statement_seconds, left) * 1000)}';\n" if self.bounded else ''
        self.process.stdin.write(limit + statement.rstrip().rstrip(';') + ';\n\\echo ' + marker + '\n')
        self.process.stdin.flush()
        rows = []
        for line in self.process.stdout:
            line = line.rstrip('\n')
            if line == marker:
                return rows
            rows.append(line.split('|'))
        self.errors.seek(0)
        error = self.errors.read()[-2000:]
        if any(reason in error for reason in ('statement timeout', 'transaction timeout', 'idle-in-transaction timeout')):
            raise Aborted(f'server timeout: {error.strip()}')
        raise RuntimeError(f'psql ended: {error.strip()}')

    def close(self, commit):
        try:
            if self.process.poll() is None:
                self.process.stdin.write(('COMMIT' if commit else 'ROLLBACK') + ';\n\\q\n')
                self.process.stdin.flush()
                self.process.wait(timeout=30)
        except (BrokenPipeError, subprocess.TimeoutExpired, OSError):
            pass
        if self.process.poll() is None:
            self.process.kill()  # the server aborts the read-only transaction with the connection


def credits(candidates, exact, k):
    """(credits, denominator) of recall@k: each distinct row among the candidates' first k (in the product's order:
    original-vector distance, then the schema's tie-break) counts once when it is in the exact first k or its distance equals the exact k-th's
    (a tie at the cutoff); the denominator is k, or the exact list's size when smaller."""
    top = exact[:k]
    if not top:
        return 0, 0
    members, cutoff, seen, count = {i for i, _ in top}, top[-1][1], set(), 0
    for row, distance in candidates[:k]:
        if row in seen:
            continue
        seen.add(row)
        count += row in members or distance == cutoff
    return count, len(top)


def bootstrap(per_query, seed, rounds=2000):
    """Seeded percentile bootstrap over queries of Σ credits / Σ denominators: the 95 % interval."""
    rng, n, values = random.Random(seed), len(per_query), []
    for _ in range(rounds):
        sample = [per_query[rng.randrange(n)] for _ in range(n)]
        values.append(sum(c for c, _ in sample) / sum(d for _, d in sample))
    values.sort()
    return values[int(0.025 * rounds)], values[min(rounds - 1, int(0.975 * rounds))]


def write_private(path, data):
    """`data` as JSON at `path`, private whatever was there: a new file created with mode 600 (mkstemp) beside it, then
    atomically renamed over it."""
    fd, temporary = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), prefix='.ann-recall-probe-')
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(data, out, indent=1)
        os.replace(temporary, path)
    except BaseException:
        if os.path.exists(temporary):
            os.unlink(temporary)
        raise


def cohort_credits(candidates, exact, k, cohort):
    """recall@k split by neighbour cohort (a diagnostic, not the rule), slot by slot of the exact first k: a slot is
    credited to its neighbour's cohort when the candidates' first k hold that neighbour, or when a slot at the cutoff
    distance is taken by a candidate tied at the cutoff of the same cohort (matched cohort by cohort); a tie filling a
    cutoff slot of the other cohort counts as `ambiguous`; ties beyond the cutoff slots as `unassigned`. Each cohort's
    credits never exceed its slots."""
    top = exact[:k]
    split = dict(root=[0, 0], lineage=[0, 0], ambiguous=0, unassigned=0)
    if not top:
        return split
    cutoff, found = top[-1][1], {row for row, _ in candidates[:k]}
    members = {row for row, _ in top}
    ties = collections.Counter(cohort[row] for row in {row for row, d in candidates[:k] if row not in members and d == cutoff})
    open_slots = collections.Counter()
    for row, distance in top:
        split[cohort[row]][1] += 1
        if row in found:
            split[cohort[row]][0] += 1
        elif distance == cutoff:
            open_slots[cohort[row]] += 1
    for name in ('root', 'lineage'):
        same = min(open_slots[name], ties[name])
        split[name][0] += same
        open_slots[name] -= same
        ties[name] -= same
    split['ambiguous'] = min(sum(open_slots.values()), sum(ties.values()))
    split['unassigned'] = sum(ties.values()) - split['ambiguous']
    return split


def digest(vectors):
    return hashlib.sha256('\n'.join(vectors).encode()).hexdigest()


def measure(args):
    if not re.fullmatch(r'[A-Za-z0-9_.@-]{1,128}', args.reader):
        sys.exit('--reader: an account id ([A-Za-z0-9_.@-])')
    baseline = None
    if args.queries_from:
        baseline = json.load(open(args.queries_from))
        if baseline.get('probeVersion') != PROBE_VERSION or not baseline.get('queryVectors'):
            sys.exit(f'--queries-from: not a baseline of probe version {PROBE_VERSION} with saved query vectors')
        if baseline['reader'] != args.reader:
            sys.exit(f'--queries-from: the baseline measured reader {baseline["reader"]}, not {args.reader}')
        args.seed = baseline['seed']
    elif args.queries < GATE_MIN_QUERIES and not args.trial:
        sys.exit(f'--queries: at least {GATE_MIN_QUERIES} (smaller only with --trial)')
    started, reader = time.monotonic(), literal(args.reader)
    session = Session(args.dsn, started + args.max_seconds, args.statement_seconds)
    result, committed = None, False
    try:
        # Backstops for the whole transaction: transaction_timeout from PostgreSQL 17 on (--no-transaction-timeout:
        # development, to exercise the per-statement bound alone); below 17 the per-statement bound and the idle timeout.
        if not args.no_transaction_timeout:
            session.run(f"SELECT set_config('transaction_timeout', '{int(args.max_seconds * 1000)}', false) WHERE current_setting('server_version_num')::int >= 170000")
        session.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        session.bounded = True
        session.run(f"SET LOCAL idle_in_transaction_session_timeout = '{int(min(args.idle_seconds, args.max_seconds) * 1000)}'")
        session.run(f"SET LOCAL lock_timeout = '{int(args.lock_seconds * 1000)}'")
        session.run(f"SET LOCAL work_mem = {literal(args.work_mem)}")  # the service role's work_mem bounds the iterative scan's memory
        server = session.run("SELECT current_setting('server_version'), (SELECT extversion FROM pg_extension WHERE extname='vector'), now(), "
                             "to_regclass('ch_lineage_segments') IS NOT NULL, (SELECT reltuples::bigint FROM pg_class WHERE oid='ch_search_chunks'::regclass), "
                             "current_setting('transaction_read_only')")[0]
        schema = args.schema if args.schema != 'auto' else 'l5' if server[3] == 't' else 'pre-l5'
        assert server[5] == 'on', 'the transaction is not read-only'
        if int(server[4]) > args.max_table_rows:
            raise Aborted(f'ch_search_chunks holds about {int(server[4]):,} rows, above --max-table-rows {args.max_table_rows:,}')
        target = session.run(f"SELECT t.profile, p.embedding_space FROM ch_owner_targets t JOIN ch_index_profiles p ON p.profile=t.profile WHERE t.owner={reader}")
        profile = target[0][0] if target else None
        space = args.space or (target[0][1] if target else None)
        if space is None:
            raise RuntimeError(f'no owner target for {args.reader}: give --space')
        space_sql = literal(space)
        dims = args.dimensions or int(session.run(f"SELECT DISTINCT vector_dims(ch.embedding) FROM ch_search_chunks ch WHERE {COMPATIBLE.format(space=space_sql)} "
                                                  "AND vector_dims(ch.embedding) IS NOT NULL LIMIT 2")[0][0])
        index = f'ch_search_hnsw_d{dims}'
        counter = f"SELECT 'scans', pg_stat_get_xact_numscans({literal(index)}::regclass)"
        for name, value in ANN_SETTINGS:
            session.run(f'SET LOCAL {name} = {value}')
        settings = {name: session.run(f"SELECT current_setting({literal(name)})")[0][0] for name, _ in ANN_SETTINGS + (('work_mem', ''),)}
        limits = {name: session.run(f"SELECT current_setting({literal(name)}, true)")[0][0]
                  for name in ('statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout', 'transaction_timeout')}
        visible = int(session.run(f"SELECT count(*) FROM {visible_rows(schema, dims, reader, space_sql)}")[0][0])
        if baseline is None:
            # Query vectors: stored vectors of the reader's visible rows, by a fixed seed (md5 of seed and row id).
            sampled = session.run(f"SELECT ch.id FROM {visible_rows(schema, dims, reader, space_sql)} ORDER BY md5({literal(str(args.seed))} || ':' || ch.id::text) LIMIT {args.queries}")
            if len(sampled) < args.queries:
                raise Aborted(f'only {len(sampled)} visible rows for {args.reader}')
            vectors = dict(session.run(f"SELECT id, embedding::text FROM ch_search_chunks WHERE id IN ({','.join(literal(r[0]) for r in sampled)})"))
            queries = [(row[0], vectors[row[0]]) for row in sampled]
        else:
            queries = [(q['sourceRow'], q['vector']) for q in baseline['queryVectors']]
            if baseline['dimensions'] != dims or any(len(v.strip('[]').split(',')) != dims for _, v in queries):
                raise RuntimeError(f'the baseline\'s query vectors are not of {dims} dimensions')
        # The ANN leg per query; its HNSW use confirmed by the index's own counter of this transaction around it.
        legs, scans = [], []
        for _, vector in queries:
            before = int(session.run(counter)[0][1])
            rows = session.run(ann_sql(schema, dims, reader, space_sql, vector))
            scans.append(int(session.run(counter)[0][1]) - before)
            legs.append(ranked([(r[1], float(r[2]), *r[3:]) for r in rows], schema))  # the product's rerank order
        unscanned = [i for i, n in enumerate(scans) if n < 1]
        if unscanned:
            raise RuntimeError(f'{len(unscanned)} ANN legs did not scan {index} (queries {unscanned[:5]}): not the product\'s plan')
        # The exact top 100: one sequential pass over the visible rows for every query whose leg returned at least 100
        # rows, keeping the rows within that leg's 100th original-vector distance (an upper bound of the exact 100th
        # distance: those are visible rows), each row's vector read once; a separate exact scan for a shorter leg.
        top = max(KS)
        bounded = [i for i, leg in enumerate(legs) if len(leg) >= top]
        short = [i for i in range(len(legs)) if i not in set(bounded)]
        if len(short) > args.max_short:
            raise Aborted(f'{len(short)} legs returned fewer than {top} rows (--max-short {args.max_short})')
        exact = {i: [] for i in range(len(legs))}
        before = int(session.run(counter)[0][1])
        if bounded:
            values = ','.join(f"({i},{literal(queries[i][1])}::vector,{legs[i][top - 1][1]!r}::float8)" for i in bounded)
            # x: each visible row once, its vector detoasted once (subvector copies it whole); the lateral subquery (OFFSET 0:
            # not pulled up) keeps x the outer side, so the table is read once and every query's distance computed once per row.
            rows = session.run(f"WITH q(i, v, bound) AS MATERIALIZED (VALUES {values}) SELECT y.i, x.id, y.d{tie_columns(schema, 'x.')} FROM "
                               f"(SELECT ch.id{tie_columns(schema, 'ch.').replace(', ch.id', '')}, subvector(ch.embedding, 1, {dims}) AS e "
                               f"FROM {visible_rows(schema, dims, reader, space_sql)} OFFSET 0) x "
                               f"CROSS JOIN LATERAL (SELECT z.i, z.d FROM (SELECT q.i, x.e <=> q.v AS d, q.bound FROM q OFFSET 0) z WHERE z.d <= z.bound) y "
                               f"LIMIT {args.max_exact_rows + 1}")
            if len(rows) > args.max_exact_rows:
                raise Aborted(f'the exact pass returned more than --max-exact-rows {args.max_exact_rows:,} rows')
            for i, row, distance, *ties in rows:
                exact[int(i)].append((row, float(distance), *ties))
        order = ', '.join(f'ch.{column}' for column in TIE_BREAK[schema])
        plain_exact = lambda vector: session.run(f"SELECT ch.id, ch.embedding <=> {literal(vector)}::vector AS d{tie_columns(schema, 'ch.')} "
                                                 f"FROM {visible_rows(schema, dims, reader, space_sql)} ORDER BY d, {order} LIMIT {top}")
        for i in short:
            exact[i] = [(r[0], float(r[1]), *r[2:]) for r in plain_exact(queries[i][1])]
        exact_scans = int(session.run(counter)[0][1]) - before
        if exact_scans:
            raise RuntimeError(f'the exact pass scanned {index} ({exact_scans})')
        exact = {i: ranked(rows, schema)[:top] for i, rows in exact.items()}
        incomplete = [i for i in bounded if len(exact[i]) < top]
        if incomplete:
            raise RuntimeError(f'exact lists below {top} rows for bounded queries {incomplete[:5]}')
        # Optional cross-check of the single pass against a plain exact scan (the database's own order) for the first queries.
        for i in range(min(args.verify_exact, len(queries))):
            plain = [(r[0], float(r[1])) for r in plain_exact(queries[i][1])]
            if plain != exact[i]:
                raise RuntimeError(f'the single exact pass differs from a plain exact scan for query {i}')
        # Diagnostics (not the rule): each neighbour's session and cohort (root: a generation without a lineage version or
        # version 0; lineage: a lineage version >= 1, an incremental publication's rows); for an after run, whether the
        # baseline's exact neighbours are still visible.
        needed = sorted({row for rows in exact.values() for row, _ in rows} | {row for leg in legs for row, _ in leg[:top]})
        ids = literal('{' + ','.join(needed) + '}')
        version = 'g.lineage_version' if schema == 'l5' else 'NULL'
        info = {r[0]: (r[1], 'lineage' if r[2] and int(r[2]) >= 1 else 'root') for r in session.run(
            f"SELECT ch.id, ch.session_id, {version} FROM ch_search_chunks ch LEFT JOIN ch_generations g ON g.id=ch.generation WHERE ch.id = ANY({ids}::uuid[])")}
        cohort = {row: value[1] for row, value in info.items()}
        exact_ids = literal('{' + ','.join(sorted({row for rows in exact.values() for row, _ in rows})) + '}')
        content = dict(session.run(f"SELECT ch.id, md5(ch.embedding::text) FROM ch_search_chunks ch WHERE ch.id = ANY({exact_ids}::uuid[])"))
        still_visible = set()
        if baseline is not None:
            old = literal('{' + ','.join(sorted({n[0] for rows in baseline['exactNeighbours'] for n in rows})) + '}')
            still_visible = {r[0] for r in session.run(f"SELECT ch.id FROM {visible_rows(schema, dims, reader, space_sql)} AND ch.id = ANY({old}::uuid[])")}
        per_k = {}
        for k in KS:
            per_query = [credits(legs[i], exact[i], k) for i in range(len(queries))]
            total = (sum(c for c, _ in per_query), sum(d for _, d in per_query))
            low, high = bootstrap(per_query, args.seed + k)
            per_k[k] = dict(credits=total[0], of=total[1], recall=total[0] / total[1], ci95=[low, high], perQuery=per_query)
        diagnostics = dict(cohorts={})
        for k in KS:
            splits = [cohort_credits(legs[i], exact[i], k, cohort) for i in range(len(queries))]
            diagnostics['cohorts'][str(k)] = {**{name: [sum(x[name][j] for x in splits) for j in (0, 1)] for name in ('root', 'lineage')},
                                              **{name: sum(x[name] for x in splits) for name in ('ambiguous', 'unassigned')}}
        if baseline is not None:
            diagnostics['turnover'] = turnover(baseline['exactNeighbours'], [[(row, content[row], d) for row, d in exact[i]] for i in range(len(queries))], still_visible)
        query_digest = digest([v for _, v in queries])
        result = dict(probe='ann-recall-probe', probeVersion=PROBE_VERSION, reader=args.reader, schema=schema, tieBreak=list(TIE_BREAK[schema]),
                      server=server[0], pgvector=server[1], snapshotAt=server[2], profile=profile, space=space, dimensions=dims, index=index,
                      annSettings=settings, limits=limits, candidatesPerLeg=CANDIDATES_PER_LEG, ks=list(KS), seed=args.seed, queries=len(queries), trial=args.trial,
                      queryDigest=query_digest, queriesFrom=baseline['queryDigest'] if baseline else None, querySourceRows=[q[0] for q in queries],
                      visibleRows=visible, hnswScansPerLeg=[min(scans), max(scans)], legRows=[min(map(len, legs)), max(map(len, legs))],
                      shortLegs=len(short), exactPassRows=sum(len(v) for v in exact.values()), seconds=round(time.monotonic() - started, 1),
                      recall={str(k): v for k, v in per_k.items()}, diagnostics=diagnostics)
        if baseline is None:  # the baseline's query vectors, for the after run (--queries-from): derived data, operator side only
            result['queryVectors'] = [dict(sourceRow=row, vector=vector) for row, vector in queries]
            # its exact top 100 per query (row id, content hash of the stored vector, distance): for the after run's
            # turnover diagnostic; private too
            result['exactNeighbours'] = [[(row, content[row], d) for row, d in exact[i]] for i in range(len(queries))]
        committed = True
    except Aborted as reason:
        print(f'ABORTED (rolled back, nothing measured): {reason}', file=sys.stderr)
        session.close(False)
        sys.exit(2)
    finally:
        if committed:
            session.close(True)
        elif session.process.poll() is None:
            session.close(False)
    if args.out:
        write_private(args.out, result)
    print(f"ann-recall-probe: reader {args.reader}, schema {result['schema']}, {result['queries']} queries ({'reused from the baseline' if baseline else f'seed {args.seed}'}; "
          f"digest {result['queryDigest'][:12]}) over {result['visibleRows']:,} visible rows, snapshot {result['snapshotAt']}, {result['seconds']} s; "
          f"HNSW scans per leg {result['hnswScansPerLeg']}, short legs {result['shortLegs']}")
    for k in KS:
        v = result['recall'][str(k)]
        print(f"  recall@{k}: {v['credits']}/{v['of']} = {v['recall']:.4f}  95 % interval [{v['ci95'][0]:.4f}, {v['ci95'][1]:.4f}]")
    print_diagnostics(result)


def turnover(before, after, still_visible):
    """Per k, how the exact top k changed between the baseline and this run for the same query vectors. Neighbours are
    matched by the stored row's id, then by its vector's content hash with multiplicity (a piece stored again under a new
    id is the same neighbour; equal-distance distinct pieces stay distinct). Only provable classes are named: an entrant
    is `promoted` when its row was in the baseline's top 100 (visible then, below its top k), `new` when its row was not
    and it is nearer than the baseline's 100th neighbour (every visible row that near was in that top 100), else
    `unknown`; an exit is `displaced` when its row is still visible, else `gone`."""
    out = {}
    for k in KS:
        counts = dict(of=0, entrants=0, new=0, promoted=0, unknown=0, exits=0, displaced=0, gone=0)
        for old, new in zip(before, after):
            old_top, new_top = old[:k], new[:k]
            old_ids, new_ids = {r for r, _, _ in old_top}, {r for r, _, _ in new_top}
            old_rest, new_rest = [x for x in old_top if x[0] not in new_ids], [x for x in new_top if x[0] not in old_ids]
            def unmatched(rows, others):
                pool, left = collections.Counter(h for _, h, _ in others), []
                for row in rows:
                    if pool[row[1]] > 0:
                        pool[row[1]] -= 1
                    else:
                        left.append(row)
                return left
            entrants, exits = unmatched(new_rest, old_rest), unmatched(old_rest, new_rest)
            known, bound = {r for r, _, _ in old}, old[-1][2] if old else float('-inf')
            counts['of'] += len(new_top)
            counts['entrants'] += len(entrants)
            for row, _, distance in entrants:
                counts['promoted' if row in known else 'new' if distance < bound else 'unknown'] += 1
            counts['exits'] += len(exits)
            for row, _, _ in exits:
                counts['displaced' if row in still_visible else 'gone'] += 1
        out[str(k)] = counts
    return out


def print_diagnostics(result):
    """The diagnostics of a result (not the rule): recall by neighbour cohort, and the exact top-k turnover against the
    baseline (an after run)."""
    for k in KS:
        c = result['diagnostics']['cohorts'][str(k)]
        line = (f"  diagnostic @{k}: recall by cohort root {c['root'][0]}/{c['root'][1]}, lineage versions {c['lineage'][0]}/{c['lineage'][1]}, "
                f"ambiguous tie credits {c['ambiguous']}, unassigned ties {c['unassigned']}")
        t = result['diagnostics'].get('turnover', {}).get(str(k))
        if t:
            line += (f"; exact top-{k} turnover against the baseline {t['entrants']}/{t['of']} (new rows {t['new']}, promoted {t['promoted']}, unknown {t['unknown']}; "
                     f"exits displaced {t['displaced']}, gone {t['gone']})")
        print(line)


def incompatible(baseline, after):
    """Why two results cannot be compared by the gate (empty: comparable)."""
    reasons = []
    for run, name in ((baseline, 'baseline'), (after, 'after')):
        if run.get('probeVersion') != PROBE_VERSION:
            reasons.append(f'{name}: probe version {run.get("probeVersion")}, not {PROBE_VERSION}')
        elif run['queries'] < GATE_MIN_QUERIES or run['trial']:
            reasons.append(f'{name}: {run["queries"]} queries{" (a trial)" if run["trial"] else ""}; the gate needs at least {GATE_MIN_QUERIES}')
    if reasons:
        return reasons
    for key in ('reader', 'profile', 'space', 'dimensions', 'index', 'annSettings', 'candidatesPerLeg', 'ks', 'seed', 'queries'):
        if baseline[key] != after[key]:
            reasons.append(f'{key}: baseline {baseline[key]!r}, after {after[key]!r}')
    if (baseline['schema'], after['schema']) not in SCHEMA_PAIRS:
        reasons.append(f'schema variants: baseline {baseline["schema"]}, after {after["schema"]} (accepted: {sorted(SCHEMA_PAIRS)})')
    if after['queriesFrom'] != baseline['queryDigest'] or after['queryDigest'] != baseline['queryDigest']:
        reasons.append('the after run did not reuse the baseline\'s query vectors (--queries-from BASELINE)')
    return reasons


def compare(args):
    """The comparison rule (ann-recall-probe.md): a drop of the after-value below the baseline's 95 % interval at either k
    is a defect to fix. Refused (exit 3) unless the runs are comparable (incompatible)."""
    baseline, after = (json.load(open(path)) for path in (args.baseline, args.after))
    reasons = incompatible(baseline, after)
    if reasons:
        print('REFUSED: incompatible runs —', '; '.join(reasons))
        sys.exit(3)
    print(f"comparable: reader {baseline['reader']}, schema {baseline['schema']} -> {after['schema']}, profile {baseline['profile']}, space {baseline['space']}, "
          f"{baseline['dimensions']} dimensions, {baseline['queries']} reused queries, settings {baseline['annSettings']}; visible rows "
          f"{baseline['visibleRows']:,} -> {after['visibleRows']:,}")
    defect = False
    for k in KS:
        b, a = baseline['recall'][str(k)], after['recall'][str(k)]
        below = a['recall'] < b['ci95'][0]
        defect |= below
        print(f"recall@{k}: baseline {b['credits']}/{b['of']} = {b['recall']:.4f} [{b['ci95'][0]:.4f}, {b['ci95'][1]:.4f}]; after {a['credits']}/{a['of']} = "
              f"{a['recall']:.4f}: {'BELOW the baseline interval' if below else 'not below the baseline interval'}")
    print('DEFECT: a drop of the after-value below the baseline\'s 95 % interval — a defect to fix' if defect else 'no defect by the rule')
    print('diagnostics of the after run (not the rule; diagnose a defect with them before attributing it to L5):')
    print_diagnostics(after)
    sys.exit(1 if defect else 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    m = sub.add_parser('measure')
    m.add_argument('--reader', required=True, help='the account whose visible rows are searched (and sampled)')
    m.add_argument('--queries', type=int, default=200, help='query vectors sampled by the baseline run (at least 200 for the gate)')
    m.add_argument('--queries-from', help='the after run: reuse exactly the query vectors saved by this baseline output')
    m.add_argument('--seed', type=int, default=20261122)
    m.add_argument('--schema', choices=('auto', 'pre-l5', 'l5'), default='auto', help='auto: l5 when ch_lineage_segments exists')
    m.add_argument('--space', help='the configured embedding space id (default: the reader\'s owner target\'s)')
    m.add_argument('--dimensions', type=int, help='the configured dimensions (default: of the space\'s rows)')
    m.add_argument('--work-mem', default='4MB', help='the service role\'s work_mem (production: 4MB)')
    m.add_argument('--max-seconds', type=float, default=900, help='time budget of the whole transaction')
    m.add_argument('--statement-seconds', type=float, default=300)
    m.add_argument('--lock-seconds', type=float, default=5)
    m.add_argument('--idle-seconds', type=float, default=60, help='idle_in_transaction_session_timeout inside the transaction (a backstop)')
    m.add_argument('--no-transaction-timeout', action='store_true', help='development: leave transaction_timeout unset (as below PostgreSQL 17)')
    m.add_argument('--max-table-rows', type=int, default=20_000_000, help='abort before any scan when ch_search_chunks is estimated larger')
    m.add_argument('--max-exact-rows', type=int, default=2_000_000, help='abort when the exact pass returns more rows')
    m.add_argument('--max-short', type=int, default=5, help='abort when more legs return fewer than 100 rows (each costs an exact scan)')
    m.add_argument('--verify-exact', type=int, default=0, help='cross-check the single exact pass against plain exact scans of the first N queries')
    m.add_argument('--dsn', help='a libpq connection string or service (default: the PG* environment)')
    m.add_argument('--out', help='write the result as JSON (mode 600; a baseline\'s holds its query vectors)')
    m.add_argument('--trial', action='store_true', help='allow fewer than 200 queries (development only)')
    c = sub.add_parser('compare')
    c.add_argument('baseline')
    c.add_argument('after')
    args = parser.parse_args()
    measure(args) if args.command == 'measure' else compare(args)


if __name__ == '__main__':
    main()
