# Read-only retrieval diagnostics

`SearchDiagnostics.scala` is evaluation-only: it is **not** in the server's normal
source directories. It reuses package-visible `PostgresSearch.statement` and
`legacyStatement`, without changing production search, schemas, APIs or models.

## Input

Four positional arguments: `CONFIG REQUEST NEW_OUTPUT FIXTURE`.
`CONFIG` is the actual owned-database server configuration (credential file
references stay in that file). The helper never initializes/migrates the database,
starts a worker, ingests content or calls a model. Supply real 768-dimensional
query embeddings generated separately using that configuration's actual model.

Request shape (replace placeholders; no vector generation or fallback occurs):

```json
{
  "fixtureSha256": "SHA256_OF_EXACT_FIXTURE_BYTES",
  "maxCorpusChunks": 10000,
  "statementTimeoutSeconds": 60,
  "cases": [{
    "namespace": "attempt-1.q01.hybrid",
    "caseId": "q01",
    "principal": "ACTUAL_DB_USER_ID",
    "evaluatorPrincipal": "reader",
    "searchQuery": {
      "query": "EXACT_TASK_QUERY_FROM_FIXTURE",
      "mode": "Hybrid",
      "filter": {"project": null, "gitBranch": null, "after": null, "before": null, "tags": []},
      "limit": 100,
      "offset": 0
    },
    "vector": ["REPLACE_WITH_768_REAL_FINITE_NUMBERS"],
    "expectedPublications": [{
      "documentId": "d01",
      "sessionId": "ACTUAL_SESSION_UUID",
      "generation": "ACTUAL_GENERATION_UUID",
      "revision": 1
    }]
  }]
}
```

`expectedPublications` must contain **every** published fixture document belonging
to the evaluator principal, including documents with zero search chunks. The
reader and restricted catalogs are disjoint, not a restricted-reader superset.
The actual visible published catalog must match exactly. Source keys, immutable
revision binding IDs and profile IDs are recorded without document text.
Semantic and Hybrid modes are accepted; the full typed SearchQuery, including all
filters, is decoded by the actual generated codec. Unknown query/filter fields
fail the codec round-trip check instead of disappearing silently.

All cases share one checked JDBC read-only repeatable-read transaction. Each
case has a unique explicit namespace. Bounds: 16 MiB per input file, 64 cases,
100,000 corpus chunks per case maximum, 200,000 exhaustive rows overall,
256 MiB output, and explicit 1–600 second per-statement deadline. Exceeding a
bound fails, never truncates or relaxes the limit. Output uses CREATE_NEW;
a failed attempt may leave an empty output file, which must not be reused.
Errors print only a stable category, not JDBC/configuration details.

## Build and run

From the repository root of an owned checkout, enter the pinned toolchain:

```bash
nix develop .#chronicle --command bash
```

The normal pinned shell supplies Java, `SBT_LAUNCH_JAR` and `SBT_JAVA_OPTS` with
Maven Central configured; an empty dependency cache may require approved network
access. This is **not** an offline environment. For an approved offline run,
provision the locked dependencies/bootstrap first and supply an existing file-only
repository configuration via `SBT_JAVA_OPTS` (`-Dsbt.override.build.repos=true`,
`-Dsbt.repository.config=/absolute/approved/repositories`, `-Dsbt.offline=true`),
with `COURSIER_MODE=offline`. Do not substitute a historical ignored build file or
invent a cache path; the configured offline repository must actually exist.

Still at the repository root inside that shell, set `CONFIG`, `REQUEST`,
`FIXTURE`, `NEW_CAPTURE` and `NEW_REPORT` to absolute paths. Inputs must exist;
outputs must not exist. Then run this block. It creates its own absolute build
location and short temporary directory; no previously exported classpath or
ignored helper build files are needed. SBT source settings, compilation and
`runMain` deliberately share **one invocation**, because settings are ephemeral.

```bash
set -euo pipefail
: "${CONFIG:?absolute owned-database config required}"
: "${REQUEST:?absolute diagnostic request required}"
: "${FIXTURE:?absolute frozen fixture required}"
: "${NEW_CAPTURE:?absolute new capture path required}"
: "${NEW_REPORT:?absolute new report path required}"
for path in "$CONFIG" "$REQUEST" "$FIXTURE" "$NEW_CAPTURE" "$NEW_REPORT"; do
  [[ "$path" == /* ]] || { printf '%s\n' 'absolute paths required' >&2; exit 1; }
done
REPO="$PWD"
mkdir -p "$REPO/.local"
OWNED_BUILD="$(mktemp -d "$REPO/.local/search-diagnostics.XXXXXX")"
OWNED_TMP="$(mktemp -d /tmp/cdiag.XXXXXX)"
trap 'rm -rf -- "$OWNED_TMP"' EXIT
export HOME="$OWNED_BUILD/home"
export COURSIER_CACHE="$OWNED_BUILD/coursier"
mkdir -p "$HOME" "$COURSIER_CACHE"
read -r -a sbt_options <<< "${SBT_JAVA_OPTS:?pinned shell repository settings required}"
(
  cd "$REPO/chronicle"
  java "${sbt_options[@]}" -Dsbt.supershell=false -Dsbt.ci=true \
    -Dsbt.server.autostart=false "-Djava.io.tmpdir=$OWNED_TMP" \
    "-Duser.home=$HOME" "-Dsbt.boot.directory=$OWNED_BUILD/boot" \
    "-Dsbt.global.base=$OWNED_BUILD/global" "-Dsbt.ivy.home=$OWNED_BUILD/ivy" \
    "-Dcoursier.cache=$COURSIER_CACHE" -jar "$SBT_LAUNCH_JAR" \
    "set root / target := file(\"$OWNED_BUILD/target\")" \
    "set contracts / target := file(\"$OWNED_BUILD/contracts-target\")" \
    'set Compile / unmanagedSources += baseDirectory.value / "eval/relevance/SearchDiagnostics.scala"' \
    compile \
    "runMain chronicle.SearchDiagnostics \"$CONFIG\" \"$REQUEST\" \"$NEW_CAPTURE\" \"$FIXTURE\"" \
    </dev/null >"$OWNED_BUILD/compile-run.log" 2>&1
)
python3 "$REPO/chronicle/eval/relevance/search_diagnostics_report.py" \
  --capture "$NEW_CAPTURE" --fixture "$FIXTURE" --output "$NEW_REPORT"
python3 -m unittest discover -s "$REPO/chronicle/eval/relevance/tests" \
  -p test_search_diagnostics_report.py -v
```

Retain `OWNED_BUILD`, its compile/run log, inputs and new outputs as evidence.
Only the short SBT temporary directory is removed on shell exit. SBT's project
metadata targets also remain inside the owned checkout. Do not rerun against an
existing capture/report or reuse stale compiled artifacts from another source.

## Current production ranking

Semantic search selects up to 1,000 normalized-halfvec ANN chunks, then orders
those candidates by full-vector cosine distance. Hybrid adds up to 1,000
independently selected lexical chunks and recomputes both ranks over their union:

```text
hybridScore(chunk) = 1 / (60 + vectorRankInUnion)
                  + (lexicalScore > 0 ? 1 / (60 + lexicalRankInUnion) : 0)
```

Every union candidate receives the vector term, including lexical-only candidates.
Lexical terms can also apply to ANN candidates. This differs from retaining each
leg's original membership ranks. The best chunk determines each session's score.
There is no learned or cross-encoder reranker. A positive RRF score is not answer
confidence; unrelated authorized neighbors can score positively.

Document vectors encode Problem piece text plus the configured document prefix.
The lexical projection additionally includes generated summary and tags. Context
is not embedded. Neither source publication nor eventual agent success alone
establishes searchable Problem coverage or first-query relevance.

## Interpretation and limits

The report separates exhaustive full-cosine entity winners, exact full-cosine
chunk-budget loss, exact normalized-halfvec selection followed by full reranking,
and actual production ANN membership followed by full reranking. It also checks
the actual captured union formula independently and compares union simple cosine
and a deliberately different membership-only RRF diagnostic. Current hybrid
ranking grants vector RRF to every union candidate and lexical RRF when lex>0,
regardless of leg membership; this is not automatically a defect.

One actual SQL statement consumes one MATERIALIZED ANN traversal for scores,
leg memberships and winners. ANN ordinals and traversal order within half-distance
ties are not observed. Exact references use UUID ties; boundary-tie differences
are identified separately from strictly-better misses. Actual SQL score text is
preserved for exact numeric tie ordering; approximate formula checks do not
replace PostgreSQL's ordering with Python binary-float sums. The membership-only
RRF counterfactual instead compares exact `Fraction` sums: mathematical ties use
chunk UUID for the session winner, then session UUID for session order. Its
`scoreRational` numerator/denominator and rational `scoreExact` string preserve the
exact value; `score` is a display-only float, never its ranking key. This rational
policy does not replace or reinterpret actual PostgreSQL numeric ordering.

Legacy→live projection equality is checked for every oracle chunk; live→legacy
identity/score equality is checked for every retrieved production candidate, not
for unselected extra live rows. Actual statement execution alone does not prove
HNSW index use. Pure tests and compilation do not establish SQL runtime validity,
planner behavior, real embedding provenance, relevance, correct abstention or
answer synthesis. Those require the separately owned real-database evaluation.
