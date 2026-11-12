package ontology

import cats.effect.{IO, Resource}
import cats.effect.unsafe.IORuntime
import cats.syntax.all.*
import java.util.UUID
import scala.util.Using
import munit.FunSuite
import ontology.api.*
import ontology.domain.*
import ponygirls.runtime.JdbcDatabase

final class PostgresCapsuleControls extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private final case class Fixture(scope: String, settings: CapsuleStoreSettings, call: ServiceCall, request: CapsuleRequest)
  private def fixture(): Fixture = {
    val scope = "capsule-control-" + UUID.randomUUID()
    val settings = CapsuleStoreSettings(CapsuleSettings(Set(WorkContextKey(scope, "work")), CapsuleLimits(256, 1048576)), 4, 8)
    val principal = Principal("capsule-owner", Actor("capsule-owner", ActorKind.Agent), Set(scope), Set(Capability.Read))
    val context = ContextRecordInput(OriginContextInput.ReportedNative(CaptureContext("session", None, None, LineageStatus.Unknown, "branch", UUID.randomUUID())), Nil)
    Fixture(scope, settings, ServiceCall.internal(principal, "capsule.prepare", UUID.randomUUID()), CapsuleRequest(scope, UUID.randomUUID(), "work", Some(context), 0L, None))
  }
  private def check(work: (JdbcDatabase, GraphRepository) => IO[Unit]): Unit =
    RepositoryReproductionDatabase.resource.use(db => RepositoryReproductionDatabase.store(db).flatMap(repo => work(db, repo))).unsafeRunSync()(using runtime)
  private def ddl(db: JdbcDatabase, statements: List[String]): IO[Unit] = db.transaction(c =>
    Using.resource(c.createStatement())(s => statements.foreach(sql => { s.execute(sql); () })))
  private def counts(db: JdbcDatabase, scope: String): IO[List[Long]] = db.transaction { c =>
    List("ontology_scopes", "ontology_revisions", "ontology_inputs", "ontology_captures", "ontology_mutations", "ontology_outbox", "ontology_capsules", "ontology_deliveries").map { table =>
      Using.resource(c.prepareStatement(s"SELECT count(*) FROM $table WHERE scope = ?")) { p =>
        p.setString(1, scope); Using.resource(p.executeQuery()) { row => Require(row.next(), "fixture", "count missing"); row.getLong(1) }
      }
    }
  }
  private def request(value: Capsule, f: Fixture): DeliveryRequest = DeliveryRequest(f.scope, UUID.randomUUID(), value.id, value.payloadDigest,
    "work", f.request.reportedContext, DeliveryBoundary.ExtensionContext, None, None)
  private def replaceCapsule(db: JdbcDatabase, value: Capsule, request: CapsuleRequest): IO[Unit] = db.transaction { c =>
    Using.resource(c.prepareStatement("UPDATE ontology_capsules SET request_payload = ?, request_digest = ?, previous_capsule_id = ?, payload_digest = ?, payload = ? WHERE scope = ? AND capsule_id = ?")) { p =>
      p.setString(1, StoredJson.encode(CapsuleRequest.codecJson, request)); p.setString(2, CapsuleRows.digest(request))
      value.payload.previousCapsuleId match { case Some(id) => p.setObject(3, id); case None => p.setNull(3, java.sql.Types.OTHER) }
      p.setString(4, value.payloadDigest); p.setString(5, StoredJson.encode(Capsule.codecJson, value)); p.setString(6, value.payload.scope); p.setObject(7, value.id)
      Require(p.executeUpdate() == 1, "fixture", "expected one capsule row")
    }
  }
  for (delivery <- List(false, true)) test(s"late ledger insertion failure leaves no partial or primary state: delivery=$delivery") { check { (db, repo) =>
    val f = fixture(); val facade = repo.capsules(f.settings)
    for {
      prepared <- if (delivery) facade.prepare(f.request, f.call, UUID.randomUUID()).map(Some(_)) else IO.pure(None)
      before <- counts(db, f.scope)
      tag = "capsule_fail_" + UUID.randomUUID().toString.replace("-", "")
      table = if (delivery) "ontology_deliveries" else "ontology_capsules"
      install = ddl(db, List(
        s"CREATE FUNCTION $tag() RETURNS trigger LANGUAGE plpgsql AS $$$$ BEGIN IF NEW.scope = '${f.scope}' THEN RAISE EXCEPTION 'owned-$tag' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $$$$",
        s"CREATE TRIGGER $tag AFTER INSERT ON $table FOR EACH ROW EXECUTE FUNCTION $tag()"))
      cleanup = ddl(db, List(s"DROP TRIGGER IF EXISTS $tag ON $table", s"DROP FUNCTION IF EXISTS $tag()"))
      operation = if (delivery) facade.recordDelivery(request(prepared.get, f), f.call, UUID.randomUUID()).void else facade.prepare(f.request, f.call, UUID.randomUUID()).void
      failed <- (install *> operation.attempt).guarantee(cleanup)
      after <- counts(db, f.scope)
      graph <- repo.read(f.scope)
      _ = assert(failed.left.toOption.exists { case e: ponygirls.runtime.JdbcFailure => e.sqlState.contains("P0001"); case _ => false })
      _ = assertEquals(after, before)
      _ = assertEquals(graph, Graph.empty(f.scope))
    } yield ()
  } }
  for (delivery <- List(false, true)) test(s"ledger observation holds one scope cut while a command queues: delivery=$delivery") { check { (db, repo) =>
    import ponygirls.runtime.{JdbcConfig, JdbcLimits}
    import scala.concurrent.duration.*
    val f = fixture()
    val url = sys.env.getOrElse("ONTOLOGY_TEST_JDBC_URL", throw new IllegalStateException("owned PostgreSQL required"))
    val password = java.nio.file.Path.of(sys.env.getOrElse("ONTOLOGY_TEST_PASSWORD_FILE", throw new IllegalStateException("owned PostgreSQL password file required")))
    for {
      prepared <- if (delivery) repo.capsules(f.settings).prepare(f.request, f.call, UUID.randomUUID()).map(Some(_)) else IO.pure(None)
      _ <- PostgresQueryBarrier.resource(url, "SELECT generation, snapshot, frontier FROM ontology_scopes").use { barrier =>
        val jdbc = JdbcConfig(barrier.jdbcUrl, "postgres", password, JdbcLimits(1, 16, 10.seconds, 10.seconds, 30.seconds, 35.seconds, 60.seconds, 35.seconds))
        JdbcDatabase.resource(jdbc).use { readerDb =>
          val reader = new PostgresGraphRepository(readerDb, new AdmissionEngine, TestReview.domain, TestCuration.settings(Set("curation-fixture")))
          val operation = if (delivery) reader.capsules(f.settings).recordDelivery(request(prepared.get, f), f.call, UUID.randomUUID()).map(_.observedCut)
            else reader.capsules(f.settings).prepare(f.request, f.call, UUID.randomUUID()).map(_.payload.cut)
          val command = ApplyRequest(f.scope, UUID.randomUUID(), 0L, List(Operation.Create("claim", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Statement("Queued command", Modality.Assertion), Nil)), None)
          val admitted = Admission(TestContexts.principal(f.scope, Actor("writer", ActorKind.Agent)), Actor("service", ActorKind.Service), command.requestId,
            "2026-11-11T00:00:00Z", TestContexts.trace("command"), Nil)
          for {
            blocked = db.transaction { c => Using.resource(c.prepareStatement("WITH target AS (SELECT hashtextextended(?, 0) AS key) SELECT EXISTS (SELECT 1 FROM pg_locks, target WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1 AND classid::bigint = ((key >> 32) & 4294967295) AND objid::bigint = (key & 4294967295))")) { p =>
              p.setString(1, "ontology:" + f.scope); Using.resource(p.executeQuery()) { r => Require(r.next(), "fixture", "blocker result missing"); r.getBoolean(1) }
            } }
            _ <- Resource.make(operation.start)(fiber => barrier.release *> fiber.cancel).use { observed =>
              barrier.awaitQuery *> Resource.make(repo.apply(command, admitted).start)(fiber => barrier.release *> fiber.cancel).use { writer =>
                def waitBlocked: IO[Unit] = IO.defer(blocked.flatMap(value => if (value) IO.unit else IO.sleep(10.millis) *> waitBlocked))
                for {
                  _ <- waitBlocked.timeout(5.seconds)
                  _ <- barrier.release
                  cut <- observed.joinWithNever
                  result <- writer.joinWithNever
                  _ = assertEquals(cut, CapsuleCut(0L, 0L, 0L, None, None))
                  _ = assertEquals(result.generation, 1L)
                } yield ()
              }
            }
          } yield ()
        }
      }
      after <- repo.read(f.scope)
      _ = assertEquals((after.generation, after.sourceFrontier), (1L, 1L))
    } yield ()
  } }

  test("reconstructed adapter replays exact preparations and deliveries after discarded responses") { check { (db, repo) =>
    val f = fixture(); val facade = repo.capsules(f.settings); val id = UUID.randomUUID()
    for {
      lost <- facade.prepare(f.request, f.call, id).flatMap(_ => IO.raiseError[Unit](new java.io.IOException("controlled post-commit loss"))).attempt
      _ = assert(lost.isLeft)
      original <- facade.capsule(f.call.principal, f.scope, id)
      deliveryRequest = request(original, f)
      receiptId = UUID.randomUUID()
      deliveryLost <- facade.recordDelivery(deliveryRequest, f.call, receiptId).flatMap(_ => IO.raiseError[Unit](new java.io.IOException("controlled delivery response loss"))).attempt
      _ = assert(deliveryLost.isLeft)
      receipt <- facade.delivery(f.call.principal, f.scope, receiptId)
      before <- counts(db, f.scope)
      restarted <- RepositoryReproductionDatabase.store(db)
      rotated = ServiceCall.internal(f.call.principal.copy(credentialId = "rotated"), "retry", UUID.randomUUID())
      replay <- restarted.capsules(f.settings).prepare(f.request, rotated, UUID.randomUUID())
      replayDelivery <- restarted.capsules(f.settings).recordDelivery(deliveryRequest, rotated, UUID.randomUUID())
      after <- counts(db, f.scope)
      _ = assertEquals(replay, original)
      _ = assertEquals(replayDelivery, receipt)
      _ = assertEquals(after, before)
      _ = assertEquals(after.take(6), List.fill(6)(0L))
      _ = assertEquals(after.drop(6), List(1L, 1L))
    } yield ()
  } }
  test("resealed wrong projection is rejected by reads preparation replay and delivery") { check { (db, repo) =>
    val f = fixture(); val facade = repo.capsules(f.settings)
    for {
      original <- facade.prepare(f.request, f.call, UUID.randomUUID())
      payload = original.payload.copy(text = "Different retained account")
      changed = original.copy(payload = payload, payloadDigest = Digests.text(Wire.encode(CapsulePayload.codecJson, payload).noSpaces))
      probes = List(facade.capsule(f.call.principal, f.scope, original.id).void, facade.prepare(f.request, f.call, UUID.randomUUID()).void,
        facade.recordDelivery(request(original, f), f.call, UUID.randomUUID()).void)
      observed <- (replaceCapsule(db, changed, f.request) *> probes.traverse(_.attempt)).guarantee(replaceCapsule(db, original, f.request))
      _ = observed.foreach(value => assertEquals(value.left.toOption.collect { case e: Fault => e.code }, Some("corrupt")))
      healthy <- facade.capsule(f.call.principal, f.scope, original.id)
      _ = assertEquals(healthy, original)
    } yield ()
  } }
  test("a canonical baseline cycle is rejected without traversing indefinitely") { check { (db, repo) =>
    val f = fixture(); val facade = repo.capsules(f.settings)
    for {
      first <- facade.prepare(f.request, f.call, UUID.randomUUID())
      second <- facade.prepare(f.request.copy(requestId = UUID.randomUUID(), previousCapsuleId = Some(first.id)), f.call, UUID.randomUUID())
      payload = first.payload.copy(previousCapsuleId = Some(second.id))
      cycle = first.copy(payload = payload, payloadDigest = Digests.text(Wire.encode(CapsulePayload.codecJson, payload).noSpaces))
      alteredRequest = f.request.copy(previousCapsuleId = Some(second.id))
      observed <- (replaceCapsule(db, cycle, alteredRequest) *> facade.capsule(f.call.principal, f.scope, second.id).attempt).guarantee(replaceCapsule(db, first, f.request))
      _ = assertEquals(observed.left.toOption.collect { case e: Fault => e.code }, Some("corrupt"))
      healthy <- facade.capsule(f.call.principal, f.scope, second.id)
      _ = assertEquals(healthy, second)
    } yield ()
  } }
}
