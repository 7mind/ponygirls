package ontology

import cats.effect.{IO, Resource}
import ontology.api.*
import ontology.domain.*
import org.eclipse.rdf4j.common.transaction.IsolationLevels
import org.eclipse.rdf4j.model.{IRI, Literal, Model, Statement}
import org.eclipse.rdf4j.model.impl.LinkedHashModel
import org.eclipse.rdf4j.repository.{Repository, RepositoryConnection}
import org.eclipse.rdf4j.repository.sail.SailRepository
import org.eclipse.rdf4j.sail.memory.MemoryStore
import org.eclipse.rdf4j.sail.nativerdf.NativeStore
import org.eclipse.rdf4j.model.vocabulary.RDF
import java.nio.file.Path
import scala.util.Using
import scala.jdk.CollectionConverters.*

sealed trait RdfStorage
object RdfStorage {
  case object Memory extends RdfStorage
  final case class Native(path: Path) extends RdfStorage
}
trait RdfProjection {
  def publish(snapshot: GraphSnapshot): IO[Long]
  def snapshot(scope: String, expectedGeneration: Long): IO[GraphSnapshot]
  def subjects(scope: String, expectedGeneration: Long, predicate: String, target: Ref): IO[List[Ref]]
}
object RdfProjection {
  def resource(storage: RdfStorage, queryDeadlineSeconds: Int): Resource[IO, RdfProjection] = {
    Require(queryDeadlineSeconds > 0, "config", "positive RDF query deadline required")
    Resource.make(IO.blocking {
      val repository = new SailRepository(storage match {
        case RdfStorage.Memory => new MemoryStore()
        case RdfStorage.Native(path) => new NativeStore(path.toFile)
      })
      repository.init()
      repository
    })(repository => IO.blocking(repository.shutDown())).map(repository => new Rdf4jProjection(repository, queryDeadlineSeconds))
  }
}
final class Rdf4jProjection(repository: Repository, queryDeadlineSeconds: Int) extends RdfProjection {
  private val values = repository.getValueFactory
  private def property(name: String): IRI = values.createIRI("urn:ontology:property:" + name)
  private def graph(scope: String): IRI = values.createIRI("urn:ontology:scope:" + Digests.text(scope))
  private def record(scope: String, ref: Ref): IRI = values.createIRI(graph(scope).stringValue + ":record:" + ref.id + ":" + ref.revision)
  private def metadata(scope: String): IRI = values.createIRI(graph(scope).stringValue + ":metadata")
  private def transaction[A](write: Boolean)(f: RepositoryConnection => A): IO[A] = IO.blocking {
    Using.resource(repository.getConnection) { c =>
      c.begin(IsolationLevels.SERIALIZABLE)
      val result = f(c)
      if (write) c.commit() else c.rollback()
      result
    }
  }
  private def field(c: RepositoryConnection, scope: String, name: String): Option[String] =
    Using.resource(c.getStatements(metadata(scope), property(name), null, false, graph(scope))) { rows =>
      if (!rows.hasNext) None
      else {
        val value = rows.next().getObject match { case x: Literal => x.stringValue; case _ => throw Fault("corrupt", "RDF metadata literal required") }
        Require(!rows.hasNext, "corrupt", "duplicate RDF metadata")
        Some(value)
      }
    }
  private def generation(c: RepositoryConnection, scope: String): Option[Long] = field(c, scope, "generation").map { value =>
    try value.toLong catch { case _: NumberFormatException => throw Fault("corrupt", "invalid RDF generation") }
  }
  private def requireGeneration(c: RepositoryConnection, scope: String, expected: Long): Unit =
    Require(generation(c, scope).contains(expected), "projection-lag", "requested graph revision is not projected")
  private def requireScope(snapshot: GraphSnapshot): Unit = {
    Graph.validateCounters(snapshot)
    Require((snapshot.definitions.map(_.scope) ++ snapshot.relations.map(_.scope) ++ snapshot.bindings.map(_.scope) ++ snapshot.events.map(_.scope) ++ snapshot.selections.map(_.scope)).forall(_ == snapshot.scope), "scope", "projected record scope differs from dataset scope")
  }
  def publish(snapshot: GraphSnapshot): IO[Long] = transaction(true) { c =>
    requireScope(snapshot)
    val scope = snapshot.scope
    val digest = Digests.text(StoredJson.encode(GraphSnapshot.codecJson, snapshot))
    generation(c, scope) match {
      case Some(current) if current > snapshot.generation => readSnapshot(c, scope, current); current
      case Some(current) if current == snapshot.generation =>
        Require(field(c, scope, "digest").contains(digest), "projection-conflict", "same RDF revision has different content")
        readSnapshot(c, scope, current)
        current
      case _ =>
        val statements = render(snapshot, digest)
        c.clear(graph(scope))
        statements.foreach(statement => c.add(statement))
        snapshot.generation
    }
  }
  private def render(snapshot: GraphSnapshot, digest: String): Set[Statement] = {
    val scope = snapshot.scope
    val model: Model = new LinkedHashModel()
    val records = Graph.records(snapshot)
    Require(records.map(Graph.recordRef).distinct.size == records.size, "identity", "duplicate projection reference")
    def addMeta(name: String, value: String): Unit = { model.add(metadata(scope), property(name), values.createLiteral(value), graph(scope)); () }
    addMeta("scope", scope); addMeta("generation", snapshot.generation.toString); addMeta("coveredFrontier", snapshot.coveredFrontier.toString); addMeta("sourceFrontier", snapshot.sourceFrontier.toString); addMeta("digest", digest)
    records.zipWithIndex.foreach { case (item, ordinal) =>
      val ref = Graph.recordRef(item)
      val subject = record(scope, ref)
      def literal(name: String, value: String): Unit = { model.add(subject, property(name), values.createLiteral(value), graph(scope)); () }
      def links(name: String, targets: List[Ref]): Unit = targets.foreach { target =>
        Require(Graph.exists(snapshot, target), "reference", "unknown RDF reference")
        model.add(subject, property(name), record(scope, target), graph(scope))
      }
      def applicability(value: Applicability): Unit = {
        literal("applicabilityAccount", StoredJson.encode(Applicability.codecJson, value))
        links("applicability", Applicabilities.references(value))
      }
      literal("payload", StoredJson.encode(GraphRecord.codecJson, item))
      model.add(subject, property("ordinal"), values.createLiteral(ordinal), graph(scope))
      literal("entity", ref.id.toString); literal("revision", ref.revision.toString)
      val category = item match {
        case GraphRecord.Person(v) => literal("actorId", v.value.id); literal("actorKind", v.value.kind.toString); "actor"
        case GraphRecord.Input(v) => literal("text", v.content); literal("inputKind", v.kind.toString); literal("contributor", v.contributor.id); literal("recorder", v.recorder.id); "input-receipt"
        case GraphRecord.Node(v) =>
          applicability(v.applicability); literal("kind", Graph.kind(v.content)); literal("text", Graph.text(v.content)); literal("standing", v.standing.toString); links("basis", v.basis)
          v.content match {
            case source: Content.Source => source.descriptor match {
              case captured: SourceDescriptor.PrimaryCapture => captured.observation match {
                case execution: Observation.Execution =>
                  links("executionContract", execution.contract.toList); links("executionInput", execution.inputs); links("executionOutput", execution.outputs)
                  literal("executionComplete", execution.complete.toString); execution.exitCode.foreach(code => literal("executionExitCode", code.toString))
                case _ => ()
              }
              case _ => ()
            }
            case _ => ()
          }
          provenance(model, scope, subject, v.provenance); "definition"
        case GraphRecord.Edge(v) =>
          applicability(v.applicability); literal("kind", v.kind.toString); literal("text", v.why); literal("standing", v.standing.toString); links("source", v.sources); links("target", v.targets)
          v.detail match {
            case use: RelationDetail.AssessmentUse => links("requirement", List(use.requirement)); links("basis", use.basis); literal("assessmentUse", use.disposition.toString)
            case plan: RelationDetail.PlanRequirement => literal("workContext", plan.workContext)
            case _ => ()
          }
          provenance(model, scope, subject, v.provenance); "relation"
        case GraphRecord.Contract(v) => literal("workContext", v.workContext); links("definition", List(v.definition)); links("context", v.context); provenance(model, scope, subject, v.provenance); "binding"
        case GraphRecord.Progress(v) => links("subject", List(v.subject)); links("previous", v.previous.toList); links("evidence", v.evidence); links("gateBasis", v.gateBasis.references); links("selectionWitness", v.gateBasis.selectionWitnesses); literal("phase", v.phase.toString); provenance(model, scope, subject, v.provenance); "event"
        case GraphRecord.Selection(v) => links("binding", List(v.binding)); links("basis", v.basis); literal("selected", v.selected.toString); literal("text", v.reason); provenance(model, scope, subject, v.provenance); "binding-selection"
      }
      model.add(subject, RDF.TYPE, values.createIRI("urn:ontology:type:" + category), graph(scope))
    }
    model.asScala.toSet
  }
  private def provenance(model: Model, scope: String, subject: IRI, p: Provenance): Unit = {
    List("contributor" -> p.contributor.id, "contributorKind" -> p.contributor.kind.toString, "recorder" -> p.recorder.id, "inputReceipt" -> p.input.toString, "recordedAt" -> p.recordedAt).foreach { case (name, value) => model.add(subject, property(name), values.createLiteral(value), graph(scope)) }
  }
  def snapshot(scope: String, expectedGeneration: Long): IO[GraphSnapshot] = transaction(false)(readSnapshot(_, scope, expectedGeneration))
  private def readSnapshot(c: RepositoryConnection, scope: String, expectedGeneration: Long): GraphSnapshot = {
    requireGeneration(c, scope, expectedGeneration)
    val query = c.prepareTupleQuery("SELECT ?payload WHERE { GRAPH ?scope { ?record <urn:ontology:property:payload> ?payload ; <urn:ontology:property:ordinal> ?ordinal } } ORDER BY ?ordinal")
    query.setBinding("scope", graph(scope)); query.setMaxExecutionTime(queryDeadlineSeconds)
    val records = Using.resource(query.evaluate()) { rows =>
      val result = List.newBuilder[GraphRecord]
      while (rows.hasNext) result += StoredJson.decode(GraphRecord.codecJson, rows.next().getValue("payload").stringValue)
      result.result()
    }
    val frontier = field(c, scope, "coveredFrontier").getOrElse(throw Fault("corrupt", "missing RDF coverage"))
    val covered = try frontier.toLong catch { case _: NumberFormatException => throw Fault("corrupt", "invalid RDF coverage") }
    val sourceFrontier = field(c, scope, "sourceFrontier").getOrElse(throw Fault("corrupt", "missing RDF source frontier"))
    val captured = try sourceFrontier.toLong catch { case _: NumberFormatException => throw Fault("corrupt", "invalid RDF source frontier") }
    val result = GraphSnapshot(scope, expectedGeneration, covered, captured,
      records.collect { case GraphRecord.Node(v) => v }, records.collect { case GraphRecord.Edge(v) => v },
      records.collect { case GraphRecord.Contract(v) => v }, records.collect { case GraphRecord.Progress(v) => v }, records.collect { case GraphRecord.Person(v) => v }, records.collect { case GraphRecord.Selection(v) => v })
    val digest = Digests.text(StoredJson.encode(GraphSnapshot.codecJson, result))
    Require(field(c, scope, "digest").contains(digest), "corrupt", "RDF projection does not match checkpoint")
    val expected = try { requireScope(result); render(result, digest) } catch { case _: Fault => throw Fault("corrupt", "invalid projected records") }
    val actual = Using.resource(c.getStatements(null, null, null, false, graph(scope))) { rows =>
      val statements = Set.newBuilder[Statement]; while (rows.hasNext) statements += rows.next(); statements.result()
    }
    Require(actual == expected, "corrupt", "RDF indices disagree with canonical records")
    result
  }
  def subjects(scope: String, expectedGeneration: Long, predicate: String, target: Ref): IO[List[Ref]] = transaction(false) { c =>
    Require(Set("source", "target", "basis", "definition", "context", "subject", "previous", "evidence", "applicability", "binding", "requirement", "gateBasis", "selectionWitness", "executionContract", "executionInput", "executionOutput").contains(predicate), "query", "unknown traversal predicate")
    readSnapshot(c, scope, expectedGeneration)
    val query = c.prepareTupleQuery("SELECT ?payload WHERE { GRAPH ?scope { ?record ?predicate ?target ; <urn:ontology:property:payload> ?payload ; <urn:ontology:property:ordinal> ?ordinal } } ORDER BY ?ordinal")
    query.setBinding("scope", graph(scope)); query.setBinding("predicate", property(predicate)); query.setBinding("target", record(scope, target)); query.setMaxExecutionTime(queryDeadlineSeconds)
    Using.resource(query.evaluate()) { rows =>
      val result = List.newBuilder[Ref]
      while (rows.hasNext) result += Graph.recordRef(StoredJson.decode(GraphRecord.codecJson, rows.next().getValue("payload").stringValue))
      result.result()
    }
  }
}
