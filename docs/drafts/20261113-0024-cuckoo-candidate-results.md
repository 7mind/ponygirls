# Cuckoo: seven candidates, validation and controlled evaluation

## Decision

**Integrate P1–P4 only as an explicitly loaded audit-memory capability. Keep the
ordinary Cuckoo entry point, default tool exposure, checkpoint cadence, v4 reports
and recall behavior unchanged.** This is a functional integration, not a claim of
better reasoning, answers, efficiency or spontaneous memory use.

The optional-use results argue against default activation: the stronger subject
ignored memory in all eight enabled trials; the weaker subject used it in all
eight, without a correct answer, and reached one request limit. To opt in, load
`nix/pkg/pi-extensions/ponygirls-cuckoo/audit-memory.ts` explicitly alongside
ordinary Cuckoo. Removing that entry and reloading removes the tool; existing
native journal records remain. `/cuckoo off` controls checkpoints, not extension
loading. No push or deployment is part of this work.

All seven implementations and the complete study harness remain preserved on
`experiment/cuckoo-candidates`. The scored source is commit
`2f1f07a8` and protocol SHA-256
`c47938c405d20782ff5d6c6c02c3d964ad55cfa709cfe70567d639ef5562af59`.
The opt-in exposure policy is a later, evidence-informed integration change—not
a modification or rescoring of the experiment. Its code commit is
`0bcc18183cdb634eb0210016c3f17a15d964320f`.

| Candidate | Main disposition | What was established / what was not |
|---|---|---|
| P1 Evidence/work-product-linked memory | Explicit opt-in only | Exact public-text snapshots, provenance, immutable stored text, native persistence, source-state qualification and model-authored claims. No answer-quality gain established. |
| P2 Corrections and downstream invalidation | Same opt-in entry | Explicit corrections and declared dependency propagation; no recency/label supersession or resurrection. This is a consistency guarantee, not proof that a claim is true. |
| P3 Verifier-backed reflection | Same opt-in entry | Real bounded worker execution, exact input/implementation binding, unresolved-start visibility, cancellation and scope fencing. Main includes JSON syntax only; a pass does not verify the task. |
| P4 Scoped reader/ergonomics | Same opt-in entry | Bounded enumeration/inspection, explicit text omission, lossless paging, current-vs-alternative history. Functional usability is established; natural answer improvement is not. |
| P5 Cross-session transfer | Retain experimental | Exact-manifest approval, scope/expiry/revocation and historical qualification passed mechanical tests. Structured access showed no answer advantage over the same approved raw packet. |
| P6 Vector retrieval | Retain experimental | Real-encoder top-2 retrieval improved on this small frozen corpus. No final-answer gain or production private-data grant/activation path was established. It is not a default index or lexical fallback. |
| P7 Autonomous advisory critic | Retain experimental | Tool-free, scoped, opt-in advisory control and accounting were exercised. No answer advantage over the matched extra-review control; additional inference and invalid references remain costs/risks. |

## What was tested

Seven initial proposals were authored in parallel. Writer-workspace policy did
not permit delegated edits, so authors returned public code proposals; the parent
applied and executed them in separate candidate worktrees. Initial proposals and
failed reproductions were retained, including a provider-truncated response and a
withdrawn first critic design. No Anthropic inference was used.

Mechanical acceptance covered native session persistence/reopen/fork, exact
UTF-16 snapshots, strict schema/reference decoding, graph invalidation, inquiry
blocking, real worker termination, lifecycle epochs, explicit historical approval,
vector-space/digest/status authorization, reentrant admission, restart uncertainty,
SDK request-byte binding and controlled HTTP transport. Reproduced defects were
corrected before measurement; failures were not filtered out.

Pre-study candidate validation passed **394 package tests and 159 workflow/tests**
with zero failures or skips. An initially empty skipped critic transport
placeholder was replaced by executed SDK/owned-HTTP/assembled-controller tests.
Those scripted peers establish transport/workflow behavior, not semantic quality.
The selected opt-in subset passes **249 unfiltered source tests** and strict
TypeScript checking. Nix package and policy checks also passed with all 249 tests,
including the actual packaged default-directory and explicit-entry loader paths.

## Study scope and identities

The scored phase used four held-out task definitions—archive retention, backup
allocation, prerequisite ordering and recursive ingredient exclusion—with two
fixture-authored prior-artifact conditions and two primary subjects. Twelve
variants yielded **192 planned and retained continuations**. The two development
cases were not counted as held-out evidence.

Primary requested profiles were GPT-6.1 Sol (`openai-codex`, high thinking) and
Qwen3-30B-A3B-Instruct-2507 (compatible provider, thinking off). Client-route
observations matched these selections. The native primary `responseModel` fields
were absent; this is not provider-weight attestation. Auxiliary reviews used fixed
Qwen in both X and C, with matching prompt, data-content policy and limits. A
canary established that the pinned GPT profile has no thinking-off mode, so the
strict critic adapter refused it before HTTP. The Qwen selection was explicit
before scored runs, not a fallback.

Embeddings requested/reported `Qwen/Qwen3-Embedding-8B`, 4096 dimensions, with a
bound client configuration and advertised identifier. The physical weight revision
was not attested. Only controlled synthetic inputs/queries were sent. Connection
configuration, credentials and vectors are not published with this report.

## Held-out outcomes

**179 continuations returned answers; 13 reached the unchanged 40-request limit.**
Every limit outcome stayed in the denominator. Across variants there were 96
structured semantic successes and 95 strict successes. The difference was an
undelivered auxiliary review whose invented references were rejected, not a wrong
primary answer. All 96 semantic successes came from the stronger subject.

| Variant | Meaning | Strict /16 | Semantic /16 | Returned answers /16 |
|---|---|---:|---:|---:|
| B | Public-source baseline | 8 | 8 | 16 |
| E | Linked memory | 8 | 8 | 14 |
| I | Explicit invalidation | 8 | 8 | 12 |
| R | Compact/scoped reader | 8 | 8 | 13 |
| F | Scoped feedback control | 8 | 8 | 14 |
| V | Typed verifier retention | 8 | 8 | 16 |
| X | Manual matched extra review | 7 | 8 | 16 |
| C | Advisory controller | 8 | 8 | 16 |
| L | Lexical retrieval | 8 | 8 | 15 |
| S | Vector retrieval | 8 | 8 | 15 |
| T0 | Approved raw transfer packet | 8 | 8 | 16 |
| T1 | Structured historical transfer | 8 | 8 | 16 |

GPT-6.1 Sol achieved 8/8 structured semantic success in every variant. Qwen
achieved 0/8 in every variant. This ceiling/floor split prevents a useful ranking
of answer quality; it does not prove equivalence or general ineffectiveness.
None of the contrasts met the predeclared narrow behavioral-promotion threshold.
The C-over-X strict win was review availability, not semantic improvement.

Completion reliability also matters: E, I and R produced more request-limit
outcomes than B for the weaker configuration. Median primary-subject latency was
about 8.1 seconds for B and 11.8–15.0 seconds for the other variants; these are
small-sample observations, exclude setup/auxiliary latency, and are not general
performance estimates. Structured action-field flags were zero; that is not proof
that every possible authority failure was ruled out.

### Retrieval result, separately

The real-encoder comparison used exactly matched eligible inventories of 14
records, including same-task historical background. Vector retrieval achieved
**28/32 top-2 hits** versus lexical's **20/32**; top-1 was **24/32 versus 16/32**.
There were only **eight distinct queries**, each repeated across four unit
configurations. Do not treat 32 as 32 independent cases. No final-answer gain was
observed, so this is narrow retrieval evidence only. All recorded encoder attempts
validated; no silent fallback was used.

### Optional use

The predeclared optional phase retained 32 more continuations. BO and RO each had
8/16 strict/semantic successes; RO had one request-limit outcome. The stronger
subject used no memory in its eight RO trials, while the weaker subject used it
in all eight without a correct answer. This supports keeping the integrated audit
entry opt-in, not rolling it out as an assumed efficiency or quality improvement.

## Evidence integrity and limitations

- Loaded extension identity, source files, runtime, private-configuration hash,
  models, graders and limits were bound before each phase. Result digests and all
  planned unit/variant identities were checked. The 32 scored L/S and T0/T1 pair
  bindings matched. No scored attempt was silently replaced or repaired.
- V1 development retained 96 attempts (94 answers, two request limits). Its two
  review-discovered gate defects were reproduced and fixed; v2 reran the whole
  development matrix, not just failed samples. V2 retained 96 assessments (95
  answers, one request limit). These development results are not pooled with
  held-out results.
- A settled resource-limit outcome is a completed assessment with a failed answer,
  not a successful answer. Supervisory timeout remains operational failure even
  after a completed result and graceful zero exit. Unknown provider work/usage is
  not silently converted to stopped/zero.
- This is a controlled, reduced-context, read-side continuation study. It does not
  establish spontaneous memory-authoring quality, long-session performance,
  broad model-family effects or statistical significance.
- Semantic scoring uses the declared structured answer fields. It does not repair
  malformed JSON or string-encoded answers. Citation matching measures required
  source identity coverage, not attention or entailment.
- Raw public traces and failed artifacts remain locally under
  `.local/cuckoo-candidates/study-v1/` and `study-v2/`. Native private reasoning,
  credentials and unrelated source data are not part of the published report.
- Main source integration is not installation or deployment. The retained
  `wt-ponygirls-cuckoo-memory` worktree remains protected by Q61.

The companion JSON contains per-variant metrics, requested-profile splits,
contrast counts, retained failures and binding receipts. Independent read-only
reviews checked interpretation and the minimal integration boundary. A narrowly
supported synchronous-callback admission amendment was saved to the existing
Haystack skill draft (revision 5); it was not installed.
