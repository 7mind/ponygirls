package ontology

import cats.effect.{IO, Resource}
import cats.effect.unsafe.IORuntime
import cats.syntax.all.*
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.util.Using
import munit.FunSuite
import ontology.api.*
import ontology.domain.*
import org.eclipse.rdf4j.repository.Repository
import org.eclipse.rdf4j.repository.sail.SailRepository
import org.eclipse.rdf4j.sail.memory.MemoryStore
import org.eclipse.rdf4j.sail.nativerdf.NativeStore

abstract class RdfIdentityContract extends FunSuite {
  protected def raw: Resource[IO, Repository]
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private val target = "controlled-rdf"
  private def check(body: Repository => IO[Unit]): Unit = raw.use(body).unsafeRunSync()(using runtime)
  private def change(repo: Repository)(body: org.eclipse.rdf4j.repository.RepositoryConnection => Unit): IO[Unit] = IO.blocking {
    Using.resource(repo.getConnection) { c => c.begin(); body(c); c.commit() }
  }
  test("identity is allocated once and coherent observations retain exact local content") { check { repo =>
    val id = UUID.randomUUID(); val allocations = new AtomicInteger(0)
    for {
      projection <- Rdf4jProjection.open(repo, target, 10, IO { allocations.incrementAndGet(); id })
      _ = assertEquals(projection.instance, ProjectionInstance(target, id))
      missing <- projection.observe("missing")
      _ = assertEquals(missing, None)
      _ <- projection.publish(Graph.empty("first"))
      _ <- projection.publish(Graph.empty("second"))
      observed <- projection.observe("first")
      _ = assertEquals(observed, Some(ProjectionObservation(ProjectionCheckpoint(projection.instance, "first", 0L,
        Digests.text(StoredJson.encode(GraphSnapshot.codecJson, Graph.empty("first")))), Graph.empty("first"))))
      reopened <- Rdf4jProjection.open(repo, target, 10, IO.raiseError(new AssertionError("identity must not be reallocated")))
      retained <- reopened.observe("second")
      _ = assertEquals(reopened.instance, projection.instance)
      _ = assertEquals(retained.map(_.snapshot), Some(Graph.empty("second")))
      _ = assertEquals(allocations.get(), 1)
      wrong <- Rdf4jProjection.open(repo, "different-target", 10, IO(UUID.randomUUID())).attempt
      _ = assertEquals(wrong.left.toOption.collect { case f: Fault => f.code }, Some("projection-target"))
      unchanged <- projection.observe("first")
      _ = assertEquals(unchanged, observed)
    } yield ()
  } }
  for (location <- List("default", "scope", "reserved")) test(s"unidentified existing $location data is not stamped with an identity") { check { repo =>
    val allocations = new AtomicInteger(0)
    val values = repo.getValueFactory
    for {
      _ <- change(repo) { c =>
        val subject = values.createIRI("urn:fixture:unqualified")
        val predicate = values.createIRI("urn:fixture:value")
        if (location == "default") c.add(subject, predicate, values.createLiteral("retained"))
        else c.add(subject, predicate, values.createLiteral("retained"), values.createIRI(if (location == "reserved") "urn:ontology:store:metadata" else "urn:ontology:scope:unqualified"))
      }
      refused <- Rdf4jProjection.open(repo, target, 10, IO { allocations.incrementAndGet(); UUID.randomUUID() }).attempt
      _ = assertEquals(refused.left.toOption.collect { case f: Fault => f.code }, Some("corrupt"))
      _ = assertEquals(allocations.get(), 0)
      size <- IO.blocking(Using.resource(repo.getConnection)(_.size()))
      _ = assertEquals(size, 1L)
    } yield ()
  } }
  for (mode <- List("deleted", "replaced")) test(s"$mode identity invalidates every operation including absent-scope observation") { check { repo => for {
    projection <- Rdf4jProjection.open(repo, target, 10, IO(UUID.randomUUID()))
    _ <- projection.publish(Graph.empty("s"))
    _ <- change(repo) { c =>
      val values = repo.getValueFactory
      val metadata = values.createIRI("urn:ontology:store:metadata")
      if (mode == "deleted") c.clear()
      else {
        c.clear(metadata)
        val identity = ProjectionStoreIdentity(1, ProjectionInstance(target, UUID.randomUUID()))
        c.add(values.createIRI("urn:ontology:store:identity"), values.createIRI("urn:ontology:store:payload"),
          values.createLiteral(StoredJson.encode(ProjectionStoreIdentity.codecJson, identity)), metadata)
      }
    }
    probes = List(projection.observe("absent").void, projection.snapshot("s", 0L).void, projection.publish(Graph.empty("new")).void,
      projection.subjects("s", 0L, "target", Ref(UUID.randomUUID(), 1)).void)
    results <- probes.traverse(_.attempt)
    _ = results.foreach(result => assertEquals(result.left.toOption.collect { case f: Fault => f.code }, Some("corrupt")))
  } yield () } }
  for (mode <- List("extra", "duplicate", "malformed", "unsupported")) test(s"$mode identity metadata refuses qualification") { check { repo => for {
    projection <- Rdf4jProjection.open(repo, target, 10, IO(UUID.randomUUID()))
    _ <- change(repo) { c =>
      val v = repo.getValueFactory
      val metadata = v.createIRI("urn:ontology:store:metadata")
      val subject = v.createIRI("urn:ontology:store:identity")
      val predicate = v.createIRI("urn:ontology:store:payload")
      if (mode == "extra") c.add(subject, v.createIRI("urn:fixture:extra"), v.createLiteral("extra"), metadata)
      else {
        if (mode != "duplicate") c.clear(metadata)
        val content = if (mode == "malformed") "{}" else StoredJson.encode(ProjectionStoreIdentity.codecJson,
          ProjectionStoreIdentity(if (mode == "unsupported") 2 else 1, projection.instance.copy(incarnation = UUID.randomUUID())))
        c.add(subject, predicate, v.createLiteral(content), metadata)
      }
    }
    result <- Rdf4jProjection.open(repo, target, 10, IO.raiseError(new AssertionError("invalid metadata must not allocate identity"))).attempt
    _ = assertEquals(result.left.toOption.collect { case f: Fault => f.code }, Some(if (mode == "unsupported") "projection-format" else "corrupt"))
  } yield () } }
  test("concurrent qualification never returns competing identities for one store") { check { repo =>
    import scala.concurrent.duration.*
    for {
      count <- cats.effect.Ref.of[IO, Int](0)
      arrived <- cats.effect.Deferred[IO, Unit]
      release <- cats.effect.Deferred[IO, Unit]
      allocate = count.updateAndGet(_ + 1).flatMap(n => if (n == 2) arrived.complete(()).void else IO.unit) *> release.get *> IO(UUID.randomUUID())
      _ <- Resource.make(Rdf4jProjection.open(repo, target, 10, allocate).attempt.start)(fiber => release.complete(()).void *> fiber.cancel).use { first =>
        Resource.make(Rdf4jProjection.open(repo, target, 10, allocate).attempt.start)(fiber => release.complete(()).void *> fiber.cancel).use { second => for {
          _ <- arrived.get.timeout(5.seconds)
          _ <- release.complete(())
          a <- first.joinWithNever
          b <- second.joinWithNever
          succeeded = List(a, b).flatMap(_.toOption)
          _ = assert(succeeded.nonEmpty)
          _ = assertEquals(succeeded.map(_.instance).distinct.size, 1)
          retained <- Rdf4jProjection.open(repo, target, 10, IO.raiseError(new AssertionError("identity already established")))
          _ = assertEquals(retained.instance, succeeded.head.instance)
        } yield () }
      }
    } yield ()
  } }
  test("failed incarnation allocation leaves an empty store without a partial handle") { check { repo => for {
    failed <- Rdf4jProjection.open(repo, target, 10, IO.raiseError(new java.io.IOException("controlled allocation failure"))).attempt
    _ = assert(failed.left.toOption.exists(_.isInstanceOf[java.io.IOException]))
    empty <- IO.blocking(Using.resource(repo.getConnection)(_.isEmpty))
    _ = assert(empty)
    healthy <- Rdf4jProjection.open(repo, target, 10, IO(UUID.randomUUID()))
    absent <- healthy.observe("absent")
    _ = assertEquals(absent, None)
  } yield () } }
}
final class MemoryRdfIdentitySuite extends RdfIdentityContract {
  protected def raw: Resource[IO, Repository] = Resource.make(IO.blocking { val r = new SailRepository(new MemoryStore()); r.init(); r: Repository })(r => IO.blocking(r.shutDown()))
}
final class NativeRdfIdentitySuite extends RdfIdentityContract {
  protected def raw: Resource[IO, Repository] = RdfTestDirectory.resource.flatMap(path => Resource.make(IO.blocking { val r = new SailRepository(new NativeStore(path.toFile)); r.init(); r: Repository })(r => IO.blocking(r.shutDown())))
}
final class RdfIdentityLifecycleSuite extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  test("separate memory allocations have separate incarnations") {
    val operation = RdfProjection.resource(RdfStorage.Memory, "fixture", 10, IO(UUID.randomUUID())).use(rdf => IO.pure(rdf.instance))
    (operation, operation).tupled.map { case (a, b) => assert(a.incarnation != b.incarnation) }.unsafeRunSync()(using runtime)
  }
  test("failed native initialization releases its resource without stamping an identity") {
    RdfTestDirectory.resource.use { path => for {
      failed <- RdfProjection.resource(RdfStorage.Native(path), "fixture", 10, IO.raiseError(new java.io.IOException("controlled failure"))).use(_ => IO.unit).attempt
      _ = assert(failed.left.toOption.exists(_.isInstanceOf[java.io.IOException]))
      observed <- RdfProjection.resource(RdfStorage.Native(path), "fixture", 10, IO(UUID.randomUUID())).use(_.observe("absent"))
      _ = assertEquals(observed, None)
    } yield () }.unsafeRunSync()(using runtime)
  }
  test("native reopen preserves identity and wrong-target rejection releases its store lock") {
    RdfTestDirectory.resource.use { path => for {
      original <- RdfProjection.resource(RdfStorage.Native(path), "fixture", 10, IO(UUID.randomUUID())).use(rdf => rdf.publish(Graph.empty("s")).as(rdf.instance))
      rejected <- RdfProjection.resource(RdfStorage.Native(path), "wrong", 10, IO.raiseError(new AssertionError("must not allocate"))).use(_ => IO.unit).attempt
      _ = assertEquals(rejected.left.toOption.collect { case f: Fault => f.code }, Some("projection-target"))
      retained <- RdfProjection.resource(RdfStorage.Native(path), "fixture", 10, IO.raiseError(new AssertionError("must not allocate"))).use { rdf =>
        assertEquals(rdf.instance, original)
        rdf.observe("s")
      }
      _ = assertEquals(retained.map(_.snapshot), Some(Graph.empty("s")))
    } yield () }.unsafeRunSync()(using runtime)
  }
}
