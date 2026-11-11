package ontology

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import java.util.UUID
import scala.util.Using
import ontology.api.*
import ontology.domain.*
import ponygirls.runtime.JdbcDatabase

final class PostgresProjectionControls extends CurationRepositorySupport {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = RepositoryReproductionDatabase.resource.evalMap { db =>
    val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
    repo.initialize.as(repo: GraphRepository)
  }
  private def database(body: (JdbcDatabase, GraphRepository, String, ProjectionRepository, RdfProjection, CoordinatorLease) => IO[Unit]): Unit =
    databaseWithLease(TestCuration.FixtureLease)(body)
  private def databaseWithLease(duration: java.time.Duration)(body: (JdbcDatabase, GraphRepository, String, ProjectionRepository, RdfProjection, CoordinatorLease) => IO[Unit]): Unit = {
    val scope = "projection-control-" + UUID.randomUUID()
    run(RepositoryReproductionDatabase.resource.use { db =>
      val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, TestCuration.settings(Set(scope)).copy(leaseDuration = duration))
      val principal = Principal("projector", Actor("projector", ActorKind.Service), Set(scope), Set(Capability.Read))
      val owner = repo.projections(ProjectionSettings(principal, "controlled", Set(scope), 1))
      repo.initialize *> RdfProjection.resource(RdfStorage.Memory, "controlled", 10, IO(UUID.randomUUID())).use(rdf =>
        leased(repo)(lease => body(db, repo, scope, owner, rdf, lease)))
    })
  }
  private def ddl(db: JdbcDatabase, statements: List[String]): IO[Unit] = db.transaction { c =>
    Using.resource(c.createStatement())(statement => statements.foreach(sql => { statement.execute(sql); () }))
  }
  private def counts(db: JdbcDatabase, session: ProjectionSession): IO[List[Long]] = db.transaction { c =>
    List(("ontology_projection_acks", "session_id"), ("ontology_projection_checkpoints", "witness_session")).map { case (table, column) =>
      Using.resource(c.prepareStatement(s"SELECT count(*) FROM $table WHERE $column = ?")) { p =>
        p.setObject(1, session.id); Using.resource(p.executeQuery()) { r => Require(r.next(), "fixture", "count missing"); r.getLong(1) }
      }
    }
  }
  private def checkpoint(db: JdbcDatabase, value: ProjectionCheckpointWitness): IO[Unit] = db.transaction { c =>
    Using.resource(c.prepareStatement("INSERT INTO ontology_projection_checkpoints(generation, digest, witness_session, witness_request, payload, target_id, incarnation, scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (target_id, incarnation, scope) DO UPDATE SET generation = EXCLUDED.generation, digest = EXCLUDED.digest, witness_session = EXCLUDED.witness_session, witness_request = EXCLUDED.witness_request, payload = EXCLUDED.payload")) { p =>
      val point = value.checkpoint
      p.setLong(1, point.generation); p.setString(2, point.digest); p.setObject(3, value.sessionId); p.setObject(4, value.requestId)
      p.setString(5, StoredJson.encode(ProjectionCheckpointWitness.codecJson, value)); p.setString(6, point.instance.targetId); p.setObject(7, point.instance.incarnation); p.setString(8, point.scope)
      Require(p.executeUpdate() == 1, "fixture", "expected one checkpoint")
    }
  }
  for (boundary <- List("checkpoint", "progress")) test(s"late $boundary failure rolls back acknowledgment checkpoint and progress together") { database { (db, repo, scope, owner, rdf, lease) => for {
    session <- owner.open(UUID.randomUUID(), lease.fence, rdf.instance)
    batch <- owner.reconcileHeads(session.id)
    _ <- rdf.publish(batch.work.head.snapshot)
    observation <- rdf.observe(scope).map(_.get)
    input = ProjectionAckInput(session.id, UUID.randomUUID(), batch.work.head.target, observation.checkpoint)
    before <- counts(db, session)
    tag = "projection_fail_" + UUID.randomUUID().toString.replace("-", "")
    table = if (boundary == "checkpoint") "ontology_projection_checkpoints" else "ontology_projection_sessions"
    column = if (boundary == "checkpoint") "witness_session" else "session_id"
    event = if (boundary == "checkpoint") "INSERT OR UPDATE" else "UPDATE"
    install = ddl(db, List(
      s"CREATE FUNCTION $tag() RETURNS trigger LANGUAGE plpgsql AS $$$$ BEGIN IF NEW.$column = '${session.id}'::uuid THEN RAISE EXCEPTION 'owned-$tag' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $$$$",
      s"CREATE TRIGGER $tag AFTER $event ON $table FOR EACH ROW EXECUTE FUNCTION $tag()"))
    cleanup = ddl(db, List(s"DROP TRIGGER IF EXISTS $tag ON $table", s"DROP FUNCTION IF EXISTS $tag()"))
    failed <- (install *> owner.acknowledge(input, observation).attempt).guarantee(cleanup)
    _ = assert(failed.left.toOption.exists { case e: ponygirls.runtime.JdbcFailure => e.sqlState.contains("P0001"); case _ => false })
    after <- counts(db, session)
    repeated <- owner.reconcileHeads(session.id)
    _ = assertEquals(after, before)
    _ = assertEquals(repeated, batch)
    accepted <- owner.acknowledge(input, observation)
    ready <- owner.reconcileHeads(session.id)
    _ = assert(!accepted.replayed && ready.reconciliationComplete)
    graph <- repo.read(scope)
    _ = assertEquals(graph, Graph.empty(scope))
  } yield () } }

  test("forged completed progress cannot skip fresh head reconciliation") { database { (db, _, _, owner, rdf, lease) => for {
    id = UUID.randomUUID()
    session <- owner.open(id, lease.fence, rdf.instance)
    replace = (value: ProjectionProgress) => db.transaction { c => Using.resource(c.prepareStatement("UPDATE ontology_projection_sessions SET progress_payload = ? WHERE session_id = ?")) { p =>
      p.setString(1, StoredJson.encode(ProjectionProgress.codecJson, value)); p.setObject(2, id)
      Require(p.executeUpdate() == 1, "fixture", "expected one projection progress row")
    } }
    probes = List(owner.reconcileHeads(id).void, owner.pending(id).void, owner.open(id, lease.fence, rdf.instance).void)
    observed <- (replace(ProjectionProgress(session.scopes.size, None)) *> probes.traverse(_.attempt)).guarantee(replace(ProjectionProgress(0, None)))
    _ = observed.foreach(value => fault(value, "corrupt"))
    restored <- owner.reconcileHeads(id)
    _ = assertEquals(restored.work.size, 1)
    _ = assert(!restored.reconciliationComplete)
  } yield () } }

  for (boundary <- List("coordinator", "scope")) test(s"projection acknowledgment checks expiry after waiting on $boundary") { databaseWithLease(java.time.Duration.ofSeconds(2)) { (db, repo, scope, owner, rdf, lease) =>
    import scala.concurrent.duration.*
    val entered = new java.util.concurrent.CountDownLatch(1)
    val release = new java.util.concurrent.CountDownLatch(1)
    val holderPid = new java.util.concurrent.atomic.AtomicInteger(0)
    val hold = db.transaction { c =>
      Using.resource(c.createStatement())(s => Using.resource(s.executeQuery("SELECT pg_backend_pid()")) { r => Require(r.next(), "fixture", "PID missing"); holderPid.set(r.getInt(1)) })
      val sql = if (boundary == "coordinator") "SELECT singleton FROM ontology_curation_coordinator WHERE singleton FOR UPDATE" else "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))"
      Using.resource(c.prepareStatement(sql)) { p =>
        if (boundary == "scope") p.setString(1, "ontology:" + scope)
        Using.resource(p.executeQuery()) { r =>
          Require(r.next(), "fixture", "lock result missing"); entered.countDown()
          Require(release.await(8, java.util.concurrent.TimeUnit.SECONDS), "fixture", "projection lock release deadline exceeded")
        }
      }
    }
    val blocked = db.transaction { c => Using.resource(c.prepareStatement("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND ? = ANY(pg_blocking_pids(pid)))")) { p =>
      p.setInt(1, holderPid.get()); Using.resource(p.executeQuery()) { r => Require(r.next(), "fixture", "blocker result missing"); r.getBoolean(1) }
    } }
    val now = db.transaction(c => Using.resource(c.createStatement())(s => Using.resource(s.executeQuery("SELECT clock_timestamp()")) { r =>
      Require(r.next(), "fixture", "clock missing"); r.getObject(1, classOf[java.time.OffsetDateTime]).toInstant
    }))
    def until(value: IO[Boolean]): IO[Unit] = IO.defer(value.flatMap(done => if (done) IO.unit else IO.sleep(10.millis) *> until(value)))
    for {
      session <- owner.open(UUID.randomUUID(), lease.fence, rdf.instance)
      batch <- owner.reconcileHeads(session.id)
      _ <- rdf.publish(batch.work.head.snapshot)
      observation <- rdf.observe(scope).map(_.get)
      input = ProjectionAckInput(session.id, UUID.randomUUID(), batch.work.head.target, observation.checkpoint)
      _ <- Resource.make(hold.start)(fiber => IO(release.countDown()) *> fiber.joinWithNever).use { _ => for {
        locked <- IO.blocking(entered.await(5, java.util.concurrent.TimeUnit.SECONDS))
        _ = assert(locked)
        _ <- Resource.make(owner.acknowledge(input, observation).attempt.start)(fiber => IO(release.countDown()) *> fiber.cancel).use { pending => for {
          _ <- until(blocked).timeout(5.seconds)
          queued <- now
          _ = assert(queued.isBefore(java.time.Instant.parse(lease.expiresAt)))
          _ <- until(now.map(value => !value.isBefore(java.time.Instant.parse(lease.expiresAt)))).timeout(5.seconds)
          _ <- IO(release.countDown())
          result <- pending.joinWithNever
          _ = fault(result, "coordinator")
        } yield () }
      } yield () }
      stored <- counts(db, session)
      _ = assertEquals(stored, List(0L, 0L))
      graph <- repo.read(scope)
      _ = assertEquals(graph, Graph.empty(scope))
    } yield ()
  } }

  for (missing <- List(false, true)) test(s"a checkpoint cannot disappear or regress to an older valid witness: missing=$missing") { database { (db, repo, scope, owner, rdf, lease) => for {
    session <- owner.open(UUID.randomUUID(), lease.fence, rdf.instance)
    batch <- owner.reconcileHeads(session.id)
    _ <- rdf.publish(batch.work.head.snapshot)
    zero <- rdf.observe(scope).map(_.get)
    oldInput = ProjectionAckInput(session.id, UUID.randomUUID(), batch.work.head.target, zero.checkpoint)
    _ <- owner.acknowledge(oldInput, zero)
    _ <- mutate(repo, scope)
    pending <- owner.pending(session.id)
    _ <- rdf.publish(pending.work.head.snapshot)
    latest <- rdf.observe(scope).map(_.get)
    newInput = ProjectionAckInput(session.id, UUID.randomUUID(), pending.work.head.target, latest.checkpoint)
    _ <- owner.acknowledge(newInput, latest)
    principal = TestContexts.principal(scope, Actor("reader", ActorKind.Agent))
    old = ProjectionCheckpointWitness(zero.checkpoint, session.id, oldInput.requestId)
    current = ProjectionCheckpointWitness(latest.checkpoint, session.id, newInput.requestId)
    install = if (missing) db.transaction { c => Using.resource(c.prepareStatement("DELETE FROM ontology_projection_checkpoints WHERE target_id = ? AND incarnation = ? AND scope = ?")) { p =>
      p.setString(1, rdf.instance.targetId); p.setObject(2, rdf.instance.incarnation); p.setString(3, scope)
      Require(p.executeUpdate() == 1, "fixture", "expected one checkpoint deletion")
    } } else checkpoint(db, old)
    results <- (install *> List(owner.checkpoint(principal, rdf.instance, scope).void, owner.pending(session.id).void).traverse(_.attempt)).guarantee(checkpoint(db, current))
    _ = results.foreach(value => fault(value, "corrupt"))
    restored <- owner.checkpoint(principal, rdf.instance, scope)
    _ = assertEquals(restored, Some(latest.checkpoint))
  } yield () } }
}
