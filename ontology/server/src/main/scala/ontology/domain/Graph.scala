package ontology.domain

import ontology.api.*
import java.util.UUID
import java.nio.charset.StandardCharsets.UTF_8

final case class Fault(code: String, detail: String) extends RuntimeException(detail)
object Require {
  def apply(condition: Boolean, code: String, detail: String): Unit = if (!condition) throw Fault(code, detail)
}
final case class Admission(actor: Actor, recorder: Actor, requestId: UUID, recordedAt: String) {
  def provenance: Provenance = Provenance(actor, recorder, requestId, recordedAt)
  def ref(alias: String): Ref = Ref(UUID.nameUUIDFromBytes((requestId.toString + ":" + alias).getBytes(UTF_8)), 1)
}
final case class Applied(snapshot: GraphSnapshot, result: ApplyResult)
object Graph {
  def empty(scope: String): GraphSnapshot = GraphSnapshot(scope, 0L, 0L, Nil, Nil, Nil, Nil, Nil)
  def text(c: Content): String = c match {
    case x: Content.Outcome => x.text
    case x: Content.Constraint => x.text
    case x: Content.Task => x.text
    case x: Content.Statement => x.text
    case x: Content.Hypothesis => x.text
    case x: Content.Defect => x.text
    case x: Content.Question => x.text
    case x: Content.Decision => x.text
    case x: Content.Review => x.text
    case x: Content.Source => x.text
    case x: Content.Artifact => x.text
    case x: Content.Conflict => x.text
  }
  def kind(c: Content): String = c match {
    case _: Content.Outcome => "outcome"
    case _: Content.Constraint => "constraint"
    case _: Content.Task => "task"
    case _: Content.Statement => "statement"
    case _: Content.Hypothesis => "hypothesis"
    case _: Content.Defect => "defect"
    case _: Content.Question => "question"
    case _: Content.Decision => "decision"
    case _: Content.Review => "review"
    case _: Content.Source => "source"
    case _: Content.Artifact => "artifact"
    case _: Content.Conflict => "conflict"
  }
  def node(g: GraphSnapshot, r: Ref): Definition = g.definitions.find(_.ref == r).getOrElse(throw Fault("reference", "definition not found in scope"))
  def binding(g: GraphSnapshot, r: Ref): Binding = g.bindings.find(_.ref == r).getOrElse(throw Fault("reference", "binding not found in scope"))
  def event(g: GraphSnapshot, r: Ref): StateEvent = g.events.find(_.ref == r).getOrElse(throw Fault("reference", "event not found in scope"))
  def relation(g: GraphSnapshot, r: Ref): Relation = g.relations.find(_.ref == r).getOrElse(throw Fault("reference", "relation not found in scope"))
  def definitions(g: GraphSnapshot): List[Definition] = g.definitions.groupBy(_.ref.id).values.map(_.maxBy(_.ref.revision)).toList.sortBy(_.ref.id.toString)
  def relations(g: GraphSnapshot): List[Relation] = g.relations.groupBy(_.ref.id).values.map(_.maxBy(_.ref.revision)).toList.sortBy(_.ref.id.toString)
  def current(g: GraphSnapshot, r: Ref): Boolean = definitions(g).exists(_.ref == r) || relations(g).exists(_.ref == r) || g.bindings.exists(_.ref == r) || g.events.exists(_.ref == r) || g.actors.exists(_.ref == r)
  def exists(g: GraphSnapshot, r: Ref): Boolean = g.definitions.exists(_.ref == r) || g.relations.exists(_.ref == r) || g.bindings.exists(_.ref == r) || g.events.exists(_.ref == r) || g.actors.exists(_.ref == r)
  def latestEvent(g: GraphSnapshot, subject: Ref): Option[StateEvent] = g.events.filter(_.subject == subject).lastOption
  def governing(k: RelationKind): Boolean = Set(RelationKind.DependsOn, RelationKind.Requires, RelationKind.AssignedTo, RelationKind.PlannedOutput).contains(k)
  def context(g: GraphSnapshot, d: Ref): List[Ref] = relations(g).filter(r => r.standing == Standing.Active && governing(r.kind) && r.sources.exists(_.id == d.id)).map(_.ref)
  def validateBinding(g: GraphSnapshot, b: Binding): Unit = {
    val d = node(g, b.definition)
    Require(definitions(g).exists(x => x.ref == d.ref && x.standing == Standing.Active), "stale-context", "definition is not active current content")
    val required = context(g, d.ref)
    Require(required.forall(b.context.contains), "missing-context", "governing relations missing from binding")
    b.context.foreach { ref =>
      Require(exists(g, ref) && current(g, ref), "stale-context", "binding context changed")
      g.relations.find(_.ref == ref).filter(r => governing(r.kind)).foreach { r =>
        Require(r.standing == Standing.Active && r.sources.contains(d.ref), "stale-context", "governing relation targets an earlier definition")
        if (r.kind == RelationKind.PlannedOutput) r.targets.foreach(t => Require(definitions(g).exists(n => n.ref == t && n.standing == Standing.Active), "stale-context", "planned-output contract changed"))
      }
    }
  }
  def validateContent(g: GraphSnapshot, c: Content): Unit = {
    Require(text(c).trim.nonEmpty, "content", "nonempty text required")
    def refs(xs: List[Ref]): Unit = { Require(xs.distinct == xs, "reference", "duplicate references"); xs.foreach(r => Require(exists(g, r), "reference", "unknown content reference")) }
    def acceptance(a: Acceptance): Unit = {
      Require(a.clauses.nonEmpty != a.question.nonEmpty, "acceptance", "clauses or unresolved question required, exclusively")
      Require(a.clauses.forall(_.trim.nonEmpty), "acceptance", "empty acceptance clause")
      a.question.foreach(r => Require(node(g, r).content.isInstanceOf[Content.Question], "acceptance", "acceptance question must identify a question"))
    }
    c match {
      case x: Content.Outcome => acceptance(x.acceptance)
      case x: Content.Task => acceptance(x.acceptance)
      case x: Content.Defect => refs(x.affected)
      case x: Content.Review => refs(x.subjects); refs(x.basis); Require(x.subjects.nonEmpty, "content", "review subjects required")
      case x: Content.Conflict => refs(x.subjects); Require(x.subjects.nonEmpty && (x.status != ConflictState.Resolved || x.resolution.exists(_.trim.nonEmpty)), "content", "conflict subjects/resolution required")
      case x: Content.Source => refs(x.context)
      case _ => ()
    }
  }
  def records(g: GraphSnapshot): List[GraphRecord] = g.actors.map(GraphRecord.Person(_)) ++ g.definitions.map(GraphRecord.Node(_)) ++ g.relations.map(GraphRecord.Edge(_)) ++ g.bindings.map(GraphRecord.Contract(_)) ++ g.events.map(GraphRecord.Progress(_))
  def recordRef(r: GraphRecord): Ref = r match { case GraphRecord.Person(v) => v.ref; case GraphRecord.Node(v) => v.ref; case GraphRecord.Edge(v) => v.ref; case GraphRecord.Contract(v) => v.ref; case GraphRecord.Progress(v) => v.ref }
}
