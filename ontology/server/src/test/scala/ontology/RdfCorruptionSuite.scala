package ontology

import cats.effect.{IO, Resource}
import cats.effect.unsafe.IORuntime
import ontology.api.*
import ontology.domain.*
import org.eclipse.rdf4j.repository.Repository
import org.eclipse.rdf4j.repository.sail.SailRepository
import org.eclipse.rdf4j.sail.memory.MemoryStore
import org.eclipse.rdf4j.sail.nativerdf.NativeStore
import java.util.UUID
import scala.util.Using
import munit.FunSuite

abstract class RdfCorruptionContract extends FunSuite {
  protected def rawRepository: Resource[IO, Repository]
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private def sample: GraphSnapshot = {
    val id = UUID.randomUUID()
    new AdmissionEngine().apply(Graph.empty("scope"), ApplyRequest("scope", id, 0L, List(
      Operation.Create("a", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Statement("A", Modality.Assertion)), Nil),
      Operation.Create("b", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Statement("B", Modality.Assertion)), Nil),
      Operation.Create("c", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Statement("C", Modality.Assertion)), Nil),
      Operation.Relate("r", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.Supports, List(Target.Created("a")), List(Target.Created("b")), ontology.TestAuthoring.detail(RelationDetail.Empty()), "A supports B, not C")
    )), Admission(Actor("agent", ActorKind.Agent), Actor("host", ActorKind.Service), id, "now")).snapshot
  }
  List("snapshot", "traversal", "replay", "foreign-payload").foreach { boundary =>
    test(s"$boundary cannot accept RDF index/payload disagreement at a valid checkpoint") {
      rawRepository.use { repo =>
        val graph = sample
        val projected = new Rdf4jProjection(repo, 10)
        val cRef = graph.definitions.find(d => Graph.text(d.content) == "C").get.ref
        for {
          _ <- projected.publish(graph)
          _ <- IO.blocking {
            Using.resource(repo.getConnection) { connection =>
              val vf = repo.getValueFactory
              def property(name: String) = vf.createIRI("urn:ontology:property:" + name)
              connection.begin()
              val edge = Using.resource(connection.getStatements(null, property("target"), null, false))(_.next())
              if (boundary == "foreign-payload") {
                val payload = Using.resource(connection.getStatements(edge.getSubject, property("payload"), null, false))(_.next())
                val foreign = graph.definitions.head.copy(ref = Ref(UUID.randomUUID(), 1), scope = "other")
                connection.remove(payload)
                connection.add(edge.getSubject, property("payload"), vf.createLiteral(StoredJson.encode(GraphRecord.codecJson, GraphRecord.Node(foreign))), edge.getContext)
              } else {
                val target = Using.resource(connection.getStatements(null, property("entity"), vf.createLiteral(cRef.id.toString), false))(_.next().getSubject)
                connection.remove(edge)
                connection.add(edge.getSubject, edge.getPredicate, target, edge.getContext)
              }
              connection.commit()
            }
          }
          result <- (boundary match {
            case "snapshot" => projected.snapshot("scope", 1L).void
            case "traversal" => projected.subjects("scope", 1L, "target", cRef).void
            case "replay" => projected.publish(graph).void
            case "foreign-payload" => projected.subjects("scope", 1L, "target", graph.relations.head.targets.head).void
            case _ => IO.raiseError(new AssertionError("unknown boundary"))
          }).attempt
          _ = assertEquals(result.left.toOption.collect { case f: Fault => f.code }, Some("corrupt"))
        } yield ()
      }.unsafeRunSync()(using runtime)
    }
  }
}
final class MemoryRdfCorruptionSuite extends RdfCorruptionContract {
  protected def rawRepository: Resource[IO, Repository] = Resource.make(IO.blocking { val r = new SailRepository(new MemoryStore()); r.init(); r: Repository })(r => IO.blocking(r.shutDown()))
}
final class NativeRdfCorruptionSuite extends RdfCorruptionContract {
  protected def rawRepository: Resource[IO, Repository] = RdfTestDirectory.resource.flatMap(path => Resource.make(IO.blocking { val r = new SailRepository(new NativeStore(path.toFile)); r.init(); r: Repository })(r => IO.blocking(r.shutDown())))
}
