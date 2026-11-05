# RDF encoding of the shared project graph — bounded evaluation

This evaluates an encoding of the [shared schema](cq4-node-schema.md) and its
[binding/progress semantics](cq4-unified-graph-semantics.md), not a replacement
belief-only ontology. The [service intent](mcp-service-intent.md) remains Scala,
distage/izumi/BIO/logstage, PostgreSQL and the repository's shared retrieval library.
The custom MCP implementation and the JSON/plaintext MCP comparison remain paused.

## Separate three decisions

1. **Abstract representation:** RDF provides a graph of IRI/blank-node/literal triples.
   It need not select a triplestore, inference engine or persistence replacement.
2. **Machine constraints/querying:** SHACL Core/SPARQL and fixed SPARQL queries can
   describe/check/query parts of an application contract. They do not authenticate
   an actor, execute a task, establish entailment or recover missing human intent.
3. **Agent-facing syntax:** Turtle is one RDF serialization. JSON-LD or an ordinary
   JSON projection could expose the same graph. A Turtle finding would not establish
   a finding about every RDF syntax or about RDF-backed storage.

Use the stable RDF1.1/Turtle Recommendations (2014) and SHACL Core/SPARQL Recommendation
(2017). RDF/SHACL1.2 drafts are not implicitly part of this experiment. No ontology
imports, arbitrary query execution or inference is enabled in the instrument.

## Minimal mapping, not a catalog of new concepts

The experimental vocabulary is `urn:epg:v1:` (`g:`); exact record IRIs use
`urn:epg:record:` (`r:`), and stable entity identities use `urn:epg:entity:` (`e:`).
Those are experimental names, not production API/version commitments.

| Shared concept | RDF encoding | What it does not establish |
|---|---|---|
| Actor | IRI resource with declared human/agent/service/unknown kind | Actual identity or permission |
| Input receipt | Capture resource with contributor, recorder and input digest | Signature/authentication or original formulation by a later editor |
| Definition revision | Exact IRI, stable entity IRI, revision, kind, content, scope and capture metadata | Meaning equivalence with a changed head |
| Outcome/Constraint | First-class definition kinds with desired clauses or required/prohibited boundary | Work completion or observed behavior |
| Task | Definition with own acceptance and delegated/human-required execution classification | Assignment, execution permission or successful execution |
| Statement/Hypothesis/Defect | Attributed propositions, predictions or expected/observed/reproduction accounts | Truth, a completed investigation or verified reproduction merely from its kind |
| Question/Decision/Review | Question/alternatives/answer, choice/rationale, exact-subject findings | Actual human act or complete decision context |
| Source | Retained text, exact context refs and text digest, with protected capture metadata at ingress | Human authorship of a later compilation or truth of quoted content |
| Artifact | Content digest, media type and locator account | Existence/readability of the actual bytes at a mutable path |
| Relation revision | Explicit resource with kind, joint from-list, to-list, detail, why, scope and provenance | A bare logical implication, actual adoption or sufficiency |
| Binding | Exact definition plus governing context refs | Current applicability after a changed head/context |
| StateEvent | Binding-local predecessor, task phase/result/resolution/evidence/uncertainty | Outcome achievement or a rerun of historical work |

All eleven semantic definition kinds are represented in the demonstrator. Local
content/detail objects and ordered lists use blank nodes; externally referenced
records never rely on blank-node labels for identity. JSON-reference and Turtle
conditions expand to the **same absolute-IRI records**. List order/multiplicity is
retained; RDF triple order and duplicate triples do not create new evidence.

Example of the important separation (schematic, not an authority receipt):

```turtle
@prefix g: <urn:epg:v1:> .
@prefix r: <urn:epg:record:> .
@prefix e: <urn:epg:entity:> .

r:run-Task-v1 a g:Definition ; g:entity e:run-Task ; g:revision 1 ;
    g:kind "task" .
r:run-Requires-v2 a g:Relation ; g:kind "requires" ;
    g:from (r:run-Task-v1) ; g:to (r:run-ConditionBinding) .
r:run-NewBinding a g:Binding ; g:definition r:run-Task-v1 ;
    g:context (r:run-Requires-v2) .
r:run-OldCompletion a g:Event ; g:subject r:run-OldBinding ;
    g:phase "completed" ; g:result "fulfilled" .
```

The unchanged Task IRI does not make the old completion apply to NewBinding. Conversely,
appending progress to one binding does not revise Task-v1. Production records need all
required metadata/fields; the abbreviated example is not a conforming full packet.

### Attributed relations, not authority laundering

`adopts`/`chooses` remain resources connecting an act/account to an actually presented
Source or Binding. A raw proposal can be adopted before its later compilation exists.
Its source/contributor, the interpreter and the capture path remain distinct. The
Agent ingress can record an `interpreted_account`, not manufacture a protected
`captured_action`. A structurally consistent packet declaring a Human actor can still
conform without authenticating any real Human: this is an explicit negative control.

Joint premises belong to one `infers.from` list; separate inference resources are
alternative routes, not one merged conjunction. Work ordering, selected-plan factual
conditions, contribution, assignment, decomposition and actual/planned outputs retain
the distinct meanings specified by the unified schema. No global acyclicity is imposed
on argument/history/navigation; active ordering and finite refinement are selective.

### Snapshot scope and identity

The experiment qualifies record/entity IRIs by an opaque run namespace. Its fixed
packet root is an administrative envelope **inside one snapshot**, not a production
merge identity. Do not union conflicting snapshots and infer a current head from the
result. Named-graph labels do not by themselves authenticate provenance or supply a
standard temporal/authority interpretation. Distinct IRIs also do not magically prove
that the denoted real-world entities differ.

Original source text and native inputs remain retained, not replaced by hashes.
The text digest binds the UTF8 text; capture context and actor are also bound in the
instantiated receipt payload. This is not a signature or a claim to preserve every
possible binary/multipart input. Actual artifact/source custody remains a service
implementation obligation.

## What the executable profile checks

The bounded Python/RDFLib/pySHACL instrument lives in the separate
`epistemics-pilots` repository (Pilot S, not historical Pilot R).

| Boundary | Implemented check | Remaining limit |
|---|---|---|
| Fixed validation focus and field vocabulary | Packet target, inventoried record shapes, closed properties, datatypes/cardinality and parser closure | Raw SHACL alone can miss an unreachable untyped blank node; composed decoder rejects it |
| Lists/text/refs | Exact text roundtrips, list structure/order, known exact refs and common list/wire bounds | Not arbitrary RDF/JSON acceptance or lexical-byte preservation of a Turtle serialization |
| Sources/acceptance | Source text digest and clauses-vs-unresolved-question shape controls | Clauses can still be semantically inadequate or incomplete |
| Event history | Same-binding predecessor, singleton stream root/head, fork/cycle/result checks | Not actual execution, collector completion or factual truth |
| Contract replacement | Exact definition/relation revisions, known governing-context check including final batch order | Relevant semantic omissions/authority/applicability still need review |
| Writes/history | Atomic memory/file adapters, snapshot CAS, idempotency, immutable sources/history, real file-adapter concurrency/restart controls | Not a deployed PostgreSQL transaction/authentication/collector system |
| Capture | Server-sealed caller metadata and protected captured-action mode | Fixture Human/Host labels are declarations, not genuine authentication |

The layers are concrete, not interchangeable. **SHACL Core** checks declared field
presence/cardinality, datatypes, class/node kinds, closed properties, choices and list
paths. **SHACL-SPARQL** checks same-binding predecessors, fork/root/cycle patterns,
phase/result/resolution combinations, IRI-subject inventory, acceptance alternatives
and source-text SHA256. The **decoder/application** additionally enforces complete
consumed-triple closure, exact reference/domain roles, protected ingress, final-batch
governing context, selected ordering/refinement and transactional history/CAS/replay.
This allocation is an implementation choice, not a proof that every application check
is inexpressible in SHACL. Four fixed engineering queries cover provenance, selected
progress, relation revisions and joint/alternative inference grouping; they query
recorded facts without proving their factual warrant and are not extra subject tools.

This is a **supported profile**, not a complete executable implementation of every
unified-model lifecycle, permission, CQ4 equivalence or migration rule. The native
maintenance cases exercise Task progress; Question/Review work-state admission,
authenticated Human-required execution, collector completion and full scoped retirement
remain implementation obligations. Selection is explicitly not execution admission;
a previously selected binding may require review after a later context change.

Pinned runtime: Python3.14.8, RDFLib7.6.0, pySHACL0.40.1, from the existing locked
nixpkgs revision. SHACL-SPARQL constraints require a processor that actually executes
them; Core-only or incomplete configuration is not equivalent coverage. In this pinned
validator, rendering an invalid cyclic RDF-list report can raise `ValueError`; the
parser rejects the input, and validator failure is kept distinct from conformance.

## Engineering evidence and the registered comparison

The complete frozen engineering/analysis suite passed **116 methods** in356.174s,
zero failures/errors/skips. This later single run includes the eight resource-reduction
controls that had previously passed separately from the108-method run. Coverage includes dual
memory/real-file contracts, actual concurrent CAS, codec/shape negatives, four fixed
SPARQL queries, native forwarding and audit/projection/citation controls. Earlier
failing reproductions and a wrong-reason negative-fixture error are retained; green
initial tests did not prevent subsequent review findings. These are instrument
results, not semantic approval or native-agent format efficacy.

The new enumerated runtime closure has 166 paths. Nine tested existing host/store paths
were unreadable inside it; the owned workspace was readable, and the actual per-file
limit was 8,388,608 bytes. These are specific controls, not universal isolation or proof
that provider credentials last throughout a run.

Native canaries exposed a boundary the direct tests missed: Pi's wrapper prepended a
Python without RDFLib. All four first originals failed; an absolute backend interpreter
and a real Node→Python hostile-PATH control corrected the defect. Later a provider529
caused an empty-error native context transformation: that original remains strict-
invalid, despite recovery. No control was replaced or rescued. After the final common
relation-direction contract, all four original two-stage canaries passed actual encoded
reads, create/revise, source immutability and conversation-only continuity. Same-subject
normalized profiles match across encodings; their complete mutation schemas match the
inspected compiler. This is not credential-lifetime proof or guaranteed future validity.

**Pilot S is preregistered** at pilot commit `ce517460c9c0bf4e5379655481ad93ba8511dd04`:
219 bound inputs, registration SHA256
`b451d6a56892a74515933fd99da7ae82f22f48d8f8274ac733255721dcdde7de`.
The roster is2 non-Opus subjects ×2 read encodings ×2 synthetic multi-stage cases ×2
replicates = **16 original four-stage sessions**, launched after that commit. All16
completed their64 operational stages without replacements. Independent replay verifies
all16 originals; operational validity is not semantic adequacy. Both arms get identical
typed JSON mutations, checks/feedback and facts.
Native content audits verify that only the configured encoded read text is forwarded,
not a canonical JSON duplicate. This is consumption during graph maintenance, not
RDF-native writing or isolated comprehension.

Authority/adoption and binding/progress cases preserve independent outcomes, reporting
completion versus failed means, scoped adoption, current versus historical resolution,
changed governing context, and surviving obligations versus revoked execution means.
Semantic quality comes before resources; all attempts/invalidity are retained and
quality-conditioned pairs cannot be rescued by rematching replicates. Coding views
preserve audit-bound canonical trajectories, every mutation/feedback and all finalized
public text, including intermediate assertions later corrected; private thinking is
not public testimony. Citation eligibility does not turn rejected-payload refs into
established records, and neither citations nor replay establish entailment.

## Measured findings and the resulting boundary

The bounded comparison is complete [J33; L18]. A native argument-parse rejection
exposed missing auditor coverage: the immutable registered auditor remains unchanged;
a versioned analysis-only derivative retains the rejection without repairing/applying
it. The same16 originals independently replayed all64 checkpoints. Counts are266
calls:127 reads,139 mutation attempts;95 accepted,42 domain rejected and2 interface
rejected (including1 parse rejection). All219 registered inputs stayed unchanged.
The final combined136-method engineering/analysis suite passed356.089s with zero
failures/errors/skips; this is not semantic adequacy.

All16 original advisory returns were frozen before identity/resources;10 pass strict
coding validation and6 retain presentation failures, with additional citation/coverage
errors in4 literal payloads. Readability projections never rescue original validity.
Separate source-based parent adjudication used original A plus source checks and four
full-trajectory audit aids, not blind independent Human gold. Parent results are:

| Case | Primary criteria | Adequate | Material | Uncertain |
|---|---:|---:|---:|---:|
| Authority/adoption | 64 | 59 | 4 | 1 |
| Binding/progress | 80 | 77 | 3 | 0 |

The failures include a delayed mandatory reporting update, historical consumption
asserted through a stale binding, substitution of maintenance-packet/history behavior
for the fictional publishing outcomes, source-to-formulation inversion, an unsupported
implementation delegation/admission, and non-supply promoted to nonperformance.
Fifteen distinct consequential attempted calls (including rejected propagation), public
assertions and the separate omission are retained. Critical M1 citation and wrong
relation directions are not mechanically equated with authenticated Human approval.
All-primary adequacy does not mean the rest of a graph is error-free.

Seven JSON-reference and five Turtle originals meet every primary predicate. Five
of8 exact same-case/subject/replicate pairs qualify; all16 native-counter rechecks are
available/matching. In those five, Turtle uses more read bytes, canonical-JSON mutation-argument bytes
and cumulative native-reported tokens; elapsed native-process time is higher in4 and
lower in1. All-attempt quality/resources and exclusion coverage remain visible. This
post-treatment descriptive selection is not overall efficiency, a model-family result,
a Human-attention proxy or a general format/architecture winner.

**Provisional agent-read default: JSON-reference in this instrument.** RDF remains a
viable supported representation candidate with a separate validation/query layer;
these findings do not compare RDF-native writing, JSON-LD, human ergonomics, storage
or hybrid retrieval performance. An RDF graph can be exposed to an agent through JSON.
Production MCP, database/authentication/collector implementation and CQ4 migration
remain paused; the earlier three-tool/Scala/PostgreSQL/shared-retrieval intent is
unchanged. The accepted shared schema and its intent are not compressed away.

## Standards inspected

These are dated stable Recommendations, not the moving latest draft. Relevant
sections were extracted from retained full public HTML and read completely; this is
not a claim to have read each entire specification.

- [RDF 1.1 Concepts, §§3–4](https://www.w3.org/TR/2014/REC-rdf11-concepts-20140225/#section-rdf-graph):
  triples, exact IRI comparison, literal/blank-node identity, graph/dataset scope.
- [RDF 1.1 Turtle](https://www.w3.org/TR/2014/REC-turtle-20140225/): literals,
  collections and normative IRI-reference resolution; the introductory syntax
  explanations are informative, not a substitute for its normative grammar/parser.
- [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/): target definitions,
  property paths, validation/failures, closed shapes, SPARQL constraints/prebinding.
  Core-only processors ignore SHACL-SPARQL constructs; failures and recursive-shape
  behavior have explicit limits. Our profile is not a general recursive ontology.

The graph's domain vocabulary remains custom. Standard RDF tooling can parse/query
its structure; it does not automatically understand Outcome, delegation or adoption.
