package ontology

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import java.time.{Duration as JavaDuration, Instant, OffsetDateTime}
import java.util.UUID
import java.util.concurrent.{CountDownLatch, TimeUnit}
import ontology.api.*
import ontology.domain.*
import ponygirls.runtime.JdbcDatabase
import scala.concurrent.duration.*
import scala.util.Using

final class PostgresCurationControls extends CurationRepositorySupport {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = RepositoryReproductionDatabase.resource.evalMap { db =>
    val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
    repo.initialize.as(repo: GraphRepository)
  }
  private def withDatabase(duration: JavaDuration)(body: (JdbcDatabase, GraphRepository, CurationStoreSettings, String) => IO[Unit]): Unit = {
    val scope = "curation-control-" + UUID.randomUUID()
    val settings = TestCuration.settings(Set(scope)).copy(leaseDuration = duration)
    run(RepositoryReproductionDatabase.resource.use { db =>
      val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
      repo.initialize *> body(db, repo, settings, scope)
    })
  }
  private def ddl(db: JdbcDatabase, statements: List[String]): IO[Unit] = db.transaction { c =>
    Using.resource(c.createStatement())(s => statements.foreach(sql => { s.execute(sql); () }))
  }
  private def counts(db: JdbcDatabase, scope: String): IO[List[Long]] = db.transaction { c =>
    List("ontology_scopes", "ontology_revisions", "ontology_inputs", "ontology_captures", "ontology_outbox", "ontology_curation_attempts").map { table =>
      Using.resource(c.prepareStatement(s"SELECT count(*) FROM $table WHERE scope = ?")) { p =>
        p.setString(1, scope); Using.resource(p.executeQuery()) { r => Require(r.next(), "fixture", "count missing"); r.getLong(1) }
      }
    }
  }
  private def snapshots(db: JdbcDatabase, graph: GraphSnapshot): IO[Unit] = db.transaction { c =>
    List("ontology_scopes", "ontology_revisions").foreach { table =>
      Using.resource(c.prepareStatement(s"UPDATE $table SET snapshot = ? WHERE scope = ? AND generation = ?")) { p =>
        p.setString(1, StoredJson.encode(GraphSnapshot.codecJson, graph)); p.setString(2, graph.scope); p.setLong(3, graph.generation)
        Require(p.executeUpdate() == 1, "fixture", "expected one owned snapshot row")
      }
    }
  }
  private def headOnly(db: JdbcDatabase, graph: GraphSnapshot): IO[Unit] = db.transaction { c =>
    Using.resource(c.prepareStatement("UPDATE ontology_scopes SET snapshot = ? WHERE scope = ? AND generation = ?")) { p =>
      p.setString(1, StoredJson.encode(GraphSnapshot.codecJson, graph)); p.setString(2, graph.scope); p.setLong(3, graph.generation)
      Require(p.executeUpdate() == 1, "fixture", "expected one owned head")
    }
  }
  private def dbNow(db: JdbcDatabase): IO[Instant] = db.transaction { c =>
    Using.resource(c.createStatement())(s => Using.resource(s.executeQuery("SELECT clock_timestamp()")) { r => r.next(); r.getObject(1, classOf[OffsetDateTime]).toInstant })
  }
  private def until(check: IO[Boolean]): IO[Unit] = IO.defer(check.flatMap(done => if (done) IO.unit else IO.sleep(10.millis) *> until(check))).timeout(5.seconds)

  for (boundary <- List("coordinator", "scope")) test(s"lease expiry is checked after waiting on the $boundary lock") { withDatabase(JavaDuration.ofSeconds(2)) { (db, repo, settings, scope) =>
    capture(repo, scope) *> leased(repo) { lease =>
      val entered = new CountDownLatch(1)
      val release = new CountDownLatch(1)
      val holderPid = new java.util.concurrent.atomic.AtomicInteger(0)
      val hold = db.transaction { c =>
        Using.resource(c.createStatement())(s => Using.resource(s.executeQuery("SELECT pg_backend_pid()")) { r => r.next(); holderPid.set(r.getInt(1)) })
        val sql = if (boundary == "coordinator") "SELECT singleton FROM ontology_curation_coordinator WHERE singleton FOR UPDATE" else "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))"
        Using.resource(c.prepareStatement(sql)) { p =>
          if (boundary == "scope") p.setString(1, "ontology:" + scope)
          Using.resource(p.executeQuery()) { r =>
            Require(r.next(), "fixture", "lock row missing")
            entered.countDown()
            Require(release.await(8, TimeUnit.SECONDS), "fixture", "owned lock release deadline exceeded")
          }
        }
      }
      val blocked = db.transaction { c =>
        Using.resource(c.prepareStatement("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND ? = ANY(pg_blocking_pids(pid)))")) { p =>
          p.setInt(1, holderPid.get())
          Using.resource(p.executeQuery()) { r => r.next(); r.getBoolean(1) }
        }
      }
      val operation = if (boundary == "coordinator") repo.curation.renew(lease.fence).void else repo.curation.claim(lease.fence, scope, UUID.randomUUID(), profile).void
      Resource.make(hold.start)(fiber => IO(release.countDown()) *> fiber.joinWithNever).use { _ =>
        IO.blocking(entered.await(5, TimeUnit.SECONDS)).flatMap(locked => IO(assert(locked, "fixture did not acquire its lock"))) *>
          Resource.make(operation.attempt.start)(fiber => IO(release.countDown()) *> fiber.cancel).use { pending => for {
            _ <- until(blocked)
            queuedAt <- dbNow(db)
            _ = assert(queuedAt.isBefore(Instant.parse(lease.expiresAt)), "fixture did not queue while the lease was valid")
            _ <- until(dbNow(db).map(now => !now.isBefore(Instant.parse(lease.expiresAt))))
            _ <- IO(release.countDown())
            result <- pending.joinWithNever
            _ = fault(result, "coordinator")
            status <- repo.curation.status(settings.principal, scope)
            _ = assertEquals(status.attempt, None)
            _ = assertEquals((status.generation, status.frontier, status.coveredFrontier), (1L, 1L, 0L))
          } yield () }
      }
    }
  } }

  test("queued publication checks the attempt deadline even while renewed ownership remains valid") { withDatabase(TestCuration.FixtureLease) { (db, repo, settings, scope) =>
    val bounded = settings.copy(attemptDuration = JavaDuration.ofSeconds(3))
    val owner = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, bounded)
    owner.initialize *> capture(owner, scope) *> leased(owner) { lease => for {
      value <- begin(owner, bounded, scope, lease, Nil)
      _ <- observe(owner, scope, lease, value)
      renewed <- owner.curation.renew(lease.fence)
      deadline = Instant.parse(value.attempt.claim.deadlineAt)
      entered = new CountDownLatch(1)
      release = new CountDownLatch(1)
      pid = new java.util.concurrent.atomic.AtomicInteger(0)
      hold = db.transaction { c =>
        Using.resource(c.createStatement())(s => Using.resource(s.executeQuery("SELECT pg_backend_pid()")) { r => r.next(); pid.set(r.getInt(1)) })
        Using.resource(c.prepareStatement("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))")) { p =>
          p.setString(1, "ontology:" + scope)
          Using.resource(p.executeQuery()) { r => r.next(); entered.countDown(); Require(release.await(8, TimeUnit.SECONDS), "fixture", "scope lock release timed out") }
        }
      }
      blocked = db.transaction { c => Using.resource(c.prepareStatement("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid)))")) { p =>
        p.setInt(1, pid.get()); Using.resource(p.executeQuery()) { r => r.next(); r.getBoolean(1) }
      } }
      _ <- Resource.make(hold.start)(fiber => IO(release.countDown()) *> fiber.joinWithNever).use { _ =>
        IO.blocking(entered.await(5, TimeUnit.SECONDS)).flatMap(locked => IO(assert(locked))) *>
          Resource.make(owner.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID()).start)(fiber => IO(release.countDown()) *> fiber.cancel).use { pending => for {
            _ <- until(blocked)
            queued <- dbNow(db)
            _ = assert(queued.isBefore(deadline), "fixture must queue before the attempt deadline")
            _ <- until(dbNow(db).map(now => !now.isBefore(deadline)))
            _ <- IO(release.countDown())
            result <- pending.joinWithNever
            _ = assert(result.isInstanceOf[CurationWriteResult.Terminal])
            now <- dbNow(db)
            _ = assert(now.isBefore(Instant.parse(renewed.expiresAt)), "lease must remain valid independently of attempt expiry")
            status <- owner.curation.status(settings.principal, scope)
            _ = assertEquals(status.failure, Some("curation-expired"))
            _ = assertEquals((status.generation, status.frontier, status.coveredFrontier), (1L, 1L, 0L))
          } yield () }
      }
    } yield () }
  } }

  test("late publication failure rolls back graph input history outbox and terminal attempt together") { withDatabase(TestCuration.FixtureLease) { (db, repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    value <- begin(repo, settings, scope, lease, Nil)
    _ <- observe(repo, scope, lease, value)
    before <- repo.read(scope)
    beforeCounts <- counts(db, scope)
    tag = "curation_fail_" + UUID.randomUUID().toString.replace("-", "")
    install = ddl(db, List(
      s"CREATE FUNCTION $tag() RETURNS trigger LANGUAGE plpgsql AS $$$$ BEGIN IF NEW.scope = '$scope' AND NEW.state = 'Published' THEN RAISE EXCEPTION 'owned-$tag' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $$$$",
      s"CREATE TRIGGER $tag BEFORE UPDATE ON ontology_curation_attempts FOR EACH ROW EXECUTE FUNCTION $tag()"))
    cleanup = ddl(db, List(s"DROP TRIGGER IF EXISTS $tag ON ontology_curation_attempts", s"DROP FUNCTION IF EXISTS $tag()"))
    failed <- (install *> repo.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID()).attempt).guarantee(cleanup)
    _ = assert(failed.left.toOption.exists { case error: ponygirls.runtime.JdbcFailure => error.sqlState.contains("P0001"); case _ => false })
    after <- repo.read(scope)
    afterCounts <- counts(db, scope)
    stored <- repo.curation.inspect(settings.principal, scope, value.attempt.claim.attemptId)
    missing <- repo.input(scope, CurationIdentity.input(scope, value.attempt.claim.attemptId)).attempt
    _ = assertEquals(after, before)
    _ = assertEquals(afterCounts, beforeCounts)
    _ = assertEquals(stored.attempt.state, CurationAttemptState.Running)
    _ = assertEquals(stored.journal.size, 3)
    _ = fault(missing, "not-found")
    committed <- repo.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID())
    _ = assert(!committed.asInstanceOf[CurationWriteResult.Published].replayed)
  } yield () } } }

  for (boundary <- List("head", "history", "outbox", "attempt", "input", "status")) test(s"$boundary rejects a valid graph that no longer matches its curation proposal") { withDatabase(TestCuration.FixtureLease) { (db, repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    value <- begin(repo, settings, scope, lease, List(Operation.Create("summary", ApplicabilityInput.Unresolved("Fixture", Nil, Nil), ContentInput.Statement("Recorded interpretation", Modality.Assertion), Nil)))
    _ <- observe(repo, scope, lease, value)
    result <- repo.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID())
    receipt = published(result)
    original <- repo.read(scope)
    ref = CurationIdentity.record(scope, value.attempt.claim.attemptId, "summary")
    altered = original.copy(definitions = original.definitions.map(node => if (node.ref == ref) node.copy(content = Content.Statement("Different interpretation", Modality.Assertion)) else node))
    probe: IO[Unit] = boundary match {
      case "head" => repo.read(scope).void
      case "history" => repo.history(scope, receipt.generation).void
      case "outbox" => repo.pendingProjections(10000).void
      case "attempt" => repo.curation.inspect(settings.principal, scope, value.attempt.claim.attemptId).void
      case "input" => repo.input(scope, receipt.input).void
      case "status" => repo.curation.status(settings.principal, scope).void
    }
    _ <- probe
    observed <- (snapshots(db, altered) *> probe.attempt).guarantee(snapshots(db, original))
    _ = fault(observed, "corrupt")
    _ <- probe
  } yield () } } }

  for (later <- List(false, true); duplicate <- List(false, true)) test(s"unbacked Curation records reject with later=$later duplicate=$duplicate") { withDatabase(TestCuration.FixtureLease) { (db, repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    value <- begin(repo, settings, scope, lease, List(Operation.Create("summary", ApplicabilityInput.Unresolved("Fixture", Nil, Nil), ContentInput.Statement("Recorded interpretation", Modality.Assertion), Nil)))
    _ <- observe(repo, scope, lease, value)
    _ <- repo.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID())
    _ <- if (later) mutate(repo, scope).void else IO.unit
    original <- repo.read(scope)
    existing = Graph.node(original, CurationIdentity.record(scope, value.attempt.claim.attemptId, "summary"))
    added = if (duplicate) existing else existing.copy(ref = Ref(UUID.randomUUID(), 1), content = Content.Statement("Unbacked extra claim", Modality.Assertion))
    altered = original.copy(definitions = original.definitions :+ added)
    install = if (later) snapshots(db, altered) else headOnly(db, altered)
    restore = if (later) snapshots(db, original) else headOnly(db, original)
    observed <- (install *> repo.read(scope).attempt).guarantee(restore)
    _ = fault(observed, "corrupt")
    restored <- repo.read(scope)
    _ = assertEquals(restored, original)
  } yield () } } }

  test("a corrupted later head does not erase earlier valid publication evidence") { withDatabase(TestCuration.FixtureLease) { (db, repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    value <- begin(repo, settings, scope, lease, List(Operation.Create("summary", ApplicabilityInput.Unresolved("Fixture", Nil, Nil), ContentInput.Statement("Recorded interpretation", Modality.Assertion), Nil)))
    _ <- observe(repo, scope, lease, value)
    result <- repo.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID())
    receipt = published(result)
    publishedGraph <- repo.read(scope)
    _ <- mutate(repo, scope)
    original <- repo.read(scope)
    ref = CurationIdentity.record(scope, value.attempt.claim.attemptId, "summary")
    altered = original.copy(definitions = original.definitions.map(node => if (node.ref == ref) node.copy(content = Content.Statement("Altered later copy", Modality.Assertion)) else node))
    observed <- (snapshots(db, altered) *> (for {
      bad <- repo.read(scope).attempt
      old <- repo.history(scope, receipt.generation)
      retained <- repo.curation.inspect(settings.principal, scope, value.attempt.claim.attemptId)
      input <- repo.input(scope, receipt.input)
      _ = assertEquals(old, publishedGraph)
      _ = assertEquals(retained.attempt.state, CurationAttemptState.Published)
      _ = assertEquals(input.generation, receipt.generation)
    } yield bad)).guarantee(snapshots(db, original))
    _ = fault(observed, "corrupt")
  } yield () } } }

  for (bound <- List("input", "ordinals"); boundary <- List("retained", "new-frontier")) test(s"smaller $bound limits do not invalidate $boundary after reopening") { withDatabase(TestCuration.FixtureLease) { (db, repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    value <- begin(repo, settings, scope, lease, Nil)
    toolMessage = io.circe.Json.obj("role" -> io.circe.Json.fromString("assistant"), "content" -> io.circe.Json.Null,
      "tool_calls" -> io.circe.Json.arr(io.circe.Json.obj("id" -> io.circe.Json.fromString("controlled-read"), "type" -> io.circe.Json.fromString("function"),
        "function" -> io.circe.Json.obj("name" -> io.circe.Json.fromString("graph_read"), "arguments" -> io.circe.Json.fromString(StoredJson.encode(ReadRequest.codecJson, ReadRequest(scope, ReadView.Current, Nil, None, 1)))))))
    toolResponse = payload(io.circe.Json.obj("choices" -> io.circe.Json.arr(io.circe.Json.obj("finish_reason" -> io.circe.Json.fromString("tool_calls"), "message" -> toolMessage))))
    _ <- repo.curation.appendAudit(lease.fence, scope, value.attempt.claim.attemptId, 1, CurationAuditStage.ResponseObserved, value.request.digest, Some(toolResponse))
    originalRequest = io.circe.parser.parse(value.request.content).toOption.get
    messages = originalRequest.hcursor.get[Vector[io.circe.Json]]("messages").toOption.get
    continuation = payload(originalRequest.mapObject(_.add("messages", io.circe.Json.fromValues(messages ++ Vector(toolMessage,
      io.circe.Json.obj("role" -> io.circe.Json.fromString("tool"), "tool_call_id" -> io.circe.Json.fromString("controlled-read"), "content" -> io.circe.Json.fromString("Controlled empty page")))))))
    _ <- repo.curation.appendAudit(lease.fence, scope, value.attempt.claim.attemptId, 2, CurationAuditStage.RequestPrepared, continuation.digest, Some(continuation))
    _ <- repo.curation.appendAudit(lease.fence, scope, value.attempt.claim.attemptId, 2, CurationAuditStage.DispatchPossible, continuation.digest, None)
    _ <- repo.curation.appendAudit(lease.fence, scope, value.attempt.claim.attemptId, 2, CurationAuditStage.ResponseObserved, continuation.digest, Some(value.response))
    result <- repo.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate.copy(responseOrdinal = 2), UUID.randomUUID())
    receipt = published(result)
    smaller = settings.copy(guards = if (bound == "input") settings.guards.copy(maxInputBytes = 1L) else settings.guards.copy(maxOrdinals = 1))
    reopened = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, smaller)
    _ <- reopened.initialize
    outcome <- (if (boundary == "retained") for {
      view <- reopened.curation.inspect(settings.principal, scope, value.attempt.claim.attemptId)
      _ = assertEquals(view.journal.size, 6)
      _ = assertEquals(view.attempt.claim.admissionLimits, settings.guards.toWire)
      frozen <- reopened.curation.frozen(settings.principal, scope, value.attempt.claim.attemptId)
      _ = assert(frozen.material.manifest.inputBytes > 1L)
      _ <- reopened.input(scope, receipt.input)
      _ <- reopened.curation.status(settings.principal, scope)
    } yield () else for {
      _ <- capture(repo, scope)
      claimed <- reopened.curation.claim(lease.fence, scope, UUID.randomUUID(), profile)
      fresh = claimed match { case CurationClaimResult.Claimed(a) => a; case other => fail(s"Expected a new claim, got $other") }
      _ = assertEquals(fresh.claim.admissionLimits, smaller.guards.toWire)
      sealedResult <- reopened.curation.seal(lease.fence, scope, fresh.claim.attemptId)
      _ = if (bound == "input") assert(sealedResult.isInstanceOf[CurationWriteResult.Terminal]) else assert(sealedResult.isInstanceOf[CurationWriteResult.Advanced])
      after <- reopened.curation.status(settings.principal, scope)
      _ = assertEquals((after.frontier, after.coveredFrontier), (2L, 1L))
    } yield ()).attempt
    _ = assert(outcome.isRight, outcome.fold(error => s"Unexpected ${error.getClass.getName}: ${error.getMessage}", _ => ""))
  } yield () } } }

  test("discarded commit acknowledgement is recovered after adapter reconstruction without another publication") { withDatabase(TestCuration.FixtureLease) { (db, repo, settings, scope) => for {
    _ <- capture(repo, scope)
    retained <- leased(repo) { lease => for {
      value <- begin(repo, settings, scope, lease, Nil)
      _ <- observe(repo, scope, lease, value)
      lost <- repo.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID())
        .flatMap(_ => IO.raiseError[Unit](new java.io.IOException("controlled acknowledgement discard"))).attempt
      _ = assert(lost.left.toOption.exists(_.isInstanceOf[java.io.IOException]))
    } yield (lease.fence, value) }
    (fence, value) = retained
    beforeCounts <- counts(db, scope)
    restarted = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
    _ <- restarted.initialize
    replay <- restarted.curation.publish(fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID())
    _ = assert(replay.asInstanceOf[CurationWriteResult.Published].replayed)
    afterCounts <- counts(db, scope)
    _ = assertEquals(afterCounts, beforeCounts)
    receipt <- restarted.input(scope, published(replay).input)
    _ = assertEquals(receipt.generation, 2L)
  } yield () } }
}
