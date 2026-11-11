package ontology.domain

import munit.FunSuite
import ontology.api.*
import ontology.Wire
import io.circe.Json
import java.util.UUID

final class AtomicAuthoringSuite extends FunSuite {
  private val engine = new AdmissionEngine
  private val actor = Actor("synthetic-author", ActorKind.Agent)
  private def j(s: String): Json = io.circe.parser.parse(s).toOption.get
  private def cr(a: String): Json = Wire.encode(Target.codecJson, Target.Created(a))
  private def ex(r: Ref): Json = Wire.encode(Target.codecJson, Target.Exact(r))
  private def raw(r: Ref): Json = Wire.encode(Ref.codecJson, r)
  private val u = j("""{"Unresolved":{"reason":"Unknown scope","basis":[],"context":[]}}""")
  private val q = j("""{"Question":{"text":"Acceptance?","alternatives":[],"answer":null,"escalation":"Unresolved"}}""")
  private val claim = j("""{"Statement":{"text":"Condition","modality":"Assertion"}}""")
  private def task(question: Json): Json = {
    val clauses = if (question.isNull) Json.arr(Json.fromString("check")) else Json.arr()
    j(s"""{"Task":{"text":"Work","acceptance":{"clauses":$clauses,"question":$question},"execution":"Delegated"}}""")
  }
  private def review(subject: Json, basis: Json): Json = j(s"""{"Review":{"text":"Review","findings":[],"subjects":[$subject],"basis":[$basis],"uncertainty":"Unknown","assessment":"Unassessed"}}""")
  private def create(a: String, c: Json, ap: Json): Json = j(s"""{"Create":{"alias":"$a","applicability":$ap,"content":$c,"basis":[]}}""")
  private def bind(a: String, d: Json): Json = j(s"""{"Bind":{"alias":"$a","definition":$d,"context":[],"workContext":"fixture"}}""")
  private def select(a: String, b: Json, basis: Json): Json = j(s"""{"SelectBinding":{"alias":"$a","binding":$b,"selected":true,"reason":"Explicit fixture selection","basis":[$basis]}}""")
  private def state(a: String, b: Json, phase: String, result: Json): Json = j(s"""{"State":{"alias":"$a","subject":$b,"previous":null,"phase":"$phase","result":$result,"resolution":"Report","evidence":[],"uncertainty":"Synthetic report"}}""")
  private def link(a: String, k: String, s: Json, t: Json, d: Json): Json = j(s"""{"Relate":{"alias":"$a","applicability":$u,"kind":"$k","sources":[$s],"targets":[$t],"detail":$d,"why":"Synthetic account"}}""")
  private def dep(e: Json): Json = j(s"""{"Dependency":{"gate":"Completion","consumption":"Historical","event":$e,"applicability":"Earlier bounded result"}}""")
  private def delegation(o: Json): Json = j(s"""{"Delegation":{"actors":["worker"],"operations":["build"],"outcomes":[$o]}}""")
  private def app(kind: String, field: String, source: Json, subject: Json): Json = j(s"""{"$kind":{"$field":"Qualified scope","basis":[$source],"context":[{"Capture":{"source":$source}},{"Subject":{"ref":$subject}}]}}""")
  private def request(g: GraphSnapshot, ops: List[Json]): ApplyRequest = {
    val id = UUID.randomUUID()
    Wire.decode(ApplyRequest.codecJson, j(s"""{"scope":"${g.scope}","requestId":"$id","expectedGeneration":"${g.generation}","operations":${Json.arr(ops*)}}"""))
  }
  private def run(g: GraphSnapshot, ops: List[Json]): Applied = {
    val r = request(g, ops)
    assertEquals(Wire.decode(ApplyRequest.codecJson, Wire.encode(ApplyRequest.codecJson, r)), r)
    val result = engine(g, r, Admission(actor, Actor("fixture-recorder", ActorKind.Unknown), r.requestId, "fixture"))
    assertEquals(Wire.decode(GraphSnapshot.codecJson, Wire.encode(GraphSnapshot.codecJson, result.snapshot)), result.snapshot)
    result
  }
  private def ref(r: Applied, a: String): Ref = r.result.created.find(_.alias == a).get.ref
  private def node(r: Applied, a: String): Definition = Graph.node(r.snapshot, ref(r, a))
  private def bad(g: GraphSnapshot, ops: List[Json], code: String): Unit = {
    val before = Wire.encode(GraphSnapshot.codecJson, g)
    assertEquals(intercept[Fault](run(g, ops)).code, code)
    assertEquals(Wire.encode(GraphSnapshot.codecJson, g), before)
  }

  // Synthetic structural fixture only: no native identity, authority or observation claim.
  private val sr = Ref(UUID.randomUUID(), 1)
  private val source = Content.Source("SYNTHETIC fixture, not native authority", Nil, "a" * 64, sr.id, "synthetic", CaptureContext("fixture", None, None, LineageStatus.Unknown, "fixture", UUID.randomUUID()), CaptureMetadata("fixture", None, None, SourceRepresentation.Text, Nil, Nil), EventOrigin.WorkerMessage, Observation.None())
  private val provenance = Provenance(Actor("fixture", ActorKind.Unknown), Actor("fixture", ActorKind.Unknown), UUID.randomUUID(), "fixture")
  private val seed = Graph.empty("atomic").copy(definitions = List(Definition(sr, "atomic", Applicability.Captured(sr), source, Standing.Active, Nil, None, provenance)))
  private def fresh: List[Json] = List(create("q", q, u), create("t", task(cr("q")), u), bind("tb", cr("t")), select("select-t", cr("tb"), cr("t")), create("c", claim, u), bind("cb", cr("c")), select("select-c", cr("cb"), cr("c")), create("r", review(cr("cb"), cr("c")), app("Declared", "statement", ex(sr), cr("cb"))))

  test("one atomic proposal resolves content and applicability without inventing acceptance") {
    val before = Wire.encode(GraphSnapshot.codecJson, seed)
    val r = run(seed, fresh)
    assertEquals(node(r, "t").content.asInstanceOf[Content.Task].acceptance.question, Some(ref(r, "q")))
    val v = node(r, "r").content.asInstanceOf[Content.Review]
    assertEquals(v.subjects, List(ref(r, "cb")))
    assertEquals(v.basis, List(ref(r, "c")))
    assertEquals(node(r, "r").applicability, Applicability.Declared("Qualified scope", List(sr), List(ApplicabilityContext.Capture(sr), ApplicabilityContext.Subject(ref(r, "cb")))))
    assertEquals(node(r, "t").provenance.contributor, actor)
    val stored = Wire.encode(GraphSnapshot.codecJson, r.snapshot).noSpaces
    assert(!stored.contains("\"Created\"")); assert(!stored.contains("\"Exact\""))
    assertEquals(Wire.encode(GraphSnapshot.codecJson, seed), before)
    bad(seed, fresh :+ state("start", cr("tb"), "Active", Json.Null), "acceptance")
  }

  test("exact references roundtrip and unresolved applicability retains exact anchors") {
    val first = run(seed, fresh)
    val r = run(first.snapshot, List(create("t2", task(ex(ref(first, "q"))), u), create("r2", review(ex(ref(first, "cb")), ex(ref(first, "c"))), app("Unresolved", "reason", ex(sr), ex(ref(first, "cb"))))))
    assertEquals(node(r, "t2").content, node(first, "t").content)
    assertEquals(node(r, "r2").content, node(first, "r").content)
    assertEquals(node(r, "r2").applicability, Applicability.Unresolved("Qualified scope", List(sr), List(ApplicabilityContext.Capture(sr), ApplicabilityContext.Subject(ref(first, "cb")))))
  }

  test("unknown or forward nested aliases fail atomically; shape checks still apply") {
    List("missing", "later").foreach { name =>
      List(task(cr(name)), review(cr(name), ex(sr)), review(ex(sr), cr(name))).foreach { c =>
        bad(seed, List(create("scratch", claim, u), create("bad", c, u), create("later", q, u)), "reference")
      }
    }
    bad(seed, List(create("t", task(ex(Ref(UUID.randomUUID(), 1))), u)), "reference")
    bad(seed, List(create("c", claim, u), create("t", task(cr("c")), u)), "acceptance")
    bad(seed, List(create("c", claim, u), create("a", claim, app("Declared", "statement", cr("c"), cr("c")))), "applicability")
  }

  test("nested detail references resolve; revision compares exact persisted detail") {
    val outcome = Wire.encode(Content.codecJson, Content.Outcome("Result", Acceptance(List("check"), None), Force.Required))
    val r = run(seed, List(create("p", task(Json.Null), u), bind("pb", cr("p")), select("select-p", cr("pb"), cr("p")), state("done", cr("pb"), "Completed", Json.fromString("NotFulfilled")), create("w", task(Json.Null), u), create("o", outcome, u), link("d", "DependsOn", cr("w"), cr("pb"), dep(cr("done"))), link("g", "Delegates", ex(sr), cr("w"), delegation(cr("o")))))
    val edge = Graph.relation(r.snapshot, ref(r, "d"))
    assertEquals(edge.detail.asInstanceOf[RelationDetail.Dependency].event, Some(ref(r, "done")))
    assertEquals(Graph.relation(r.snapshot, ref(r, "g")).detail.asInstanceOf[RelationDetail.Delegation].outcomes, List(ref(r, "o")))
    val revision = j(s"""{"ReviseRelation":{"alias":"same","ref":${raw(edge.ref)},"applicability":$u,"sources":[${ex(ref(r, "w"))}],"targets":[${ex(ref(r, "pb"))}],"detail":${dep(ex(ref(r, "done")))},"why":"Retain proposition","standing":"Active"}}""")
    val changed = run(r.snapshot, List(revision))
    assertEquals(Graph.relation(changed.snapshot, ref(changed, "same")).detail, edge.detail)
    bad(r.snapshot, List(link("bad", "DependsOn", ex(ref(r, "w")), ex(ref(r, "pb")), dep(cr("missing")))), "reference")
    bad(r.snapshot, List(link("bad", "Delegates", ex(sr), ex(ref(r, "w")), delegation(cr("later"))), create("later", outcome, u)), "reference")
  }

  test("ordinary wire input excludes protected constructors and preserves captured records") {
    List[Content](source, Content.Artifact("Synthetic", "b" * 64, "text/plain", "fixture", 1L)).foreach { c =>
      intercept[Fault] {
        request(seed, List(create("fake", Wire.encode(Content.codecJson, c), u)))
      }
    }
    val captured = Wire.encode(Applicability.codecJson, Applicability.Captured(sr))
    intercept[Fault] {
      request(seed, List(create("fake", claim, captured)))
    }
    val revision = j(s"""{"Revise":{"alias":"fake","ref":${raw(sr)},"applicability":$u,"content":$claim,"standing":"Active","basis":[${ex(sr)}],"reason":"Forbidden rewrite"}}""")
    bad(seed, List(revision), "protected")
  }
}
