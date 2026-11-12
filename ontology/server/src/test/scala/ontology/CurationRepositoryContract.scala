package ontology

import cats.effect.{IO, Resource}
import cats.effect.unsafe.IORuntime
import cats.syntax.all.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID
import munit.FunSuite
import scala.concurrent.duration.*
import ontology.api.*
import ontology.curation.{CurationInputs, FrozenCurationReader, RepositoryCurationAudit}
import ontology.domain.*

private[ontology] final case class PreparedCuration(attempt: CurationAttempt, candidate: CurationCandidate, request: CurationAuditPayload, response: CurationAuditPayload)

abstract class CurationRepositorySupport extends FunSuite {
  protected val runtime: IORuntime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository]
  protected val profile: CurationProfilePin = CurationProfilePin("controlled", "a" * 64, "b" * 64)
  protected def run[A](value: IO[A]): A = value.unsafeRunSync()(using runtime)
  protected def check(body: (GraphRepository, CurationStoreSettings, String) => IO[Unit]): Unit = {
    val scope = "curation-" + UUID.randomUUID()
    val settings = TestCuration.settings(Set(scope, scope + "-other"))
    run(repository(settings).use(repo => body(repo, settings, scope)))
  }
  protected def leased[A](repo: GraphRepository)(body: CoordinatorLease => IO[A]): IO[A] =
    Resource.make(repo.curation.acquire(UUID.randomUUID()))(lease => repo.curation.release(lease.fence)).use(body)
  protected def fault[A](value: Either[Throwable, A], code: String): Unit =
    assertEquals(value.left.toOption.collect { case error: Fault => error.code }, Some(code), value.fold(_.getClass.getName, _ => "operation succeeded"))
  protected def capture(repo: GraphRepository, scope: String): IO[IngestResult] = repo.ingest(
    IngestRequest(scope, UUID.randomUUID(), UUID.randomUUID(), None, None, EventOrigin.UserMessage,
      CaptureMetadata("fixture", None, None, SourceRepresentation.PiTranscript, Nil, Nil), "Controlled source", Observation.None()),
    Principal("fixture-capture", Actor("collector", ActorKind.Collector), Set(scope), Set(Capability.Capture)),
    Actor("fixture-service", ActorKind.Service), "2026-11-11T00:00:00Z", TestContexts.trace("fixture-capture"))
  protected def mutate(repo: GraphRepository, scope: String): IO[ApplyResult] = for {
    graph <- repo.read(scope)
    id = UUID.randomUUID()
    result <- repo.apply(ApplyRequest(scope, id, graph.generation, List(Operation.Create("ordinary", ApplicabilityInput.Unresolved("Fixture", Nil, Nil),
      ContentInput.Statement("An ordinary graph edit", Modality.Assertion), Nil)), None),
      Admission(TestContexts.principal(scope, Actor("editor", ActorKind.Agent)), Actor("fixture-service", ActorKind.Service), id,
        "2026-11-11T00:00:01Z", TestContexts.trace("fixture-apply"), Nil))
  } yield result
  protected def payload(json: Json): CurationAuditPayload = {
    val text = json.noSpaces
    CurationAuditPayload(CurationJournal.JsonEncoding, text, Digests.text(text), text.getBytes(UTF_8).length.toLong)
  }
  protected def sealedView(repo: GraphRepository, settings: CurationStoreSettings, scope: String, lease: CoordinatorLease): IO[CurationFrozenView] = for {
    id <- IO(UUID.randomUUID())
    claimed <- repo.curation.claim(lease.fence, scope, id, profile)
    _ = assert(claimed.isInstanceOf[CurationClaimResult.Claimed])
    sealedResult <- repo.curation.seal(lease.fence, scope, id)
    _ = assert(sealedResult.isInstanceOf[CurationWriteResult.Advanced])
    frozen <- repo.curation.frozen(settings.principal, scope, id)
  } yield frozen
  protected def preparedRequest(frozen: CurationFrozenView): Json = Json.obj("messages" -> Json.arr(
    Json.obj("role" -> Json.fromString("system"), "content" -> Json.fromString("Controlled policy")),
    Json.obj("role" -> Json.fromString("user"), "content" -> Json.fromString(CurationInputs.json(frozen.material.input).noSpaces))))
  protected def begin(repo: GraphRepository, settings: CurationStoreSettings, scope: String, lease: CoordinatorLease, operations: List[Operation]): IO[PreparedCuration] = for {
    result <- repo.curation.claim(lease.fence, scope, UUID.randomUUID(), profile)
    attempt = result match { case CurationClaimResult.Claimed(value) => value; case other => fail(s"Expected new claim, got $other") }
    sealedResult <- repo.curation.seal(lease.fence, scope, attempt.claim.attemptId)
    _ = assert(sealedResult.isInstanceOf[CurationWriteResult.Advanced])
    frozen <- repo.curation.frozen(settings.principal, scope, attempt.claim.attemptId)
    request = payload(Json.obj("messages" -> Json.arr(
      Json.obj("role" -> Json.fromString("system"), "content" -> Json.fromString("Controlled policy")),
      Json.obj("role" -> Json.fromString("user"), "content" -> Json.fromString(CurationInputs.json(frozen.material.input).noSpaces)))))
    proposal = CurationProposal(attempt.claim.baseGeneration, attempt.claim.frontier, operations)
    response = payload(Json.obj("choices" -> Json.arr(Json.obj("finish_reason" -> Json.fromString("stop"), "message" -> Json.obj(
      "role" -> Json.fromString("assistant"), "content" -> Json.fromString(StoredJson.encode(CurationProposal.codecJson, proposal)))))))
    candidate = CurationCandidate(attempt.claim.attemptId, frozen.material.manifest.inputDigest, 1, response.digest, proposal,
      Digests.text(StoredJson.encode(CurationProposal.codecJson, proposal)))
    prepared <- repo.curation.appendAudit(lease.fence, scope, attempt.claim.attemptId, 1, CurationAuditStage.RequestPrepared, request.digest, Some(request))
    _ = assert(prepared.isInstanceOf[CurationWriteResult.Advanced])
    possible <- repo.curation.appendAudit(lease.fence, scope, attempt.claim.attemptId, 1, CurationAuditStage.DispatchPossible, request.digest, None)
    _ = assert(possible.isInstanceOf[CurationWriteResult.Advanced])
  } yield PreparedCuration(attempt, candidate, request, response)
  protected def observe(repo: GraphRepository, scope: String, lease: CoordinatorLease, value: PreparedCuration): IO[Unit] =
    repo.curation.appendAudit(lease.fence, scope, value.attempt.claim.attemptId, 1, CurationAuditStage.ResponseObserved, value.request.digest, Some(value.response))
      .map(result => assert(result.isInstanceOf[CurationWriteResult.Advanced]))
  protected def published(value: CurationWriteResult): CurationPublicationReceipt = value match {
    case CurationWriteResult.Published(receipt, _) => receipt
    case other => fail(s"Expected publication, got $other")
  }

}

abstract class CurationRepositoryContract extends CurationRepositorySupport {
  test("coordinator acquisition replay does not renew and release preserves fencing epochs") { check { (repo, settings, scope) =>
    for {
      old <- leased(repo) { lease => for {
        replay <- repo.curation.acquire(lease.fence.ownerId)
        _ = assertEquals(replay, lease)
        denied <- repo.curation.acquire(UUID.randomUUID()).attempt
        _ = fault(denied, "coordinator")
        renewed <- repo.curation.renew(lease.fence)
        _ = assertEquals(renewed.fence, lease.fence)
        _ = assert(!java.time.Instant.parse(renewed.expiresAt).isBefore(java.time.Instant.parse(lease.expiresAt)))
      } yield lease.fence }
      _ <- leased(repo) { next => for {
        _ <- IO(assertEquals(next.fence.epoch, old.epoch + 1L))
        stale <- repo.curation.release(old).attempt
        _ = fault(stale, "coordinator")
        stillHeld <- repo.curation.acquire(next.fence.ownerId)
        _ = assertEquals(stillHeld, next)
      } yield () }
    } yield ()
  } }

  test("only a new primary frontier can recover a failed attempt and the full uncovered cut is retained") { check { (repo, settings, scope) => leased(repo) { lease => for {
    empty <- repo.curation.claim(lease.fence, scope, UUID.randomUUID(), profile)
    _ = assert(empty.isInstanceOf[CurationClaimResult.Ineligible])
    _ <- capture(repo, scope)
    ready <- repo.curation.eligibleScopes(lease.fence, 1)
    _ = assertEquals(ready.scopes, List(scope))
    claimId = UUID.randomUUID()
    first <- repo.curation.claim(lease.fence, scope, claimId, profile)
    _ = assert(first.isInstanceOf[CurationClaimResult.Claimed])
    replay <- repo.curation.claim(lease.fence, scope, claimId, profile)
    _ = assert(replay.isInstanceOf[CurationClaimResult.Replayed])
    competing <- repo.curation.claim(lease.fence, scope, UUID.randomUUID(), profile)
    _ = assert(competing.isInstanceOf[CurationClaimResult.Ineligible])
    failed <- repo.curation.stop(lease.fence, scope, claimId, CurationStop.Failed("controlled-failure"))
    _ = assert(failed.isInstanceOf[CurationWriteResult.Terminal])
    unchanged <- repo.curation.claim(lease.fence, scope, UUID.randomUUID(), profile.copy(id = "changed-profile"))
    _ = assert(unchanged.isInstanceOf[CurationClaimResult.Ineligible])
    _ <- capture(repo, scope)
    id = UUID.randomUUID()
    recovered <- repo.curation.claim(lease.fence, scope, id, profile)
    _ = assert(recovered.isInstanceOf[CurationClaimResult.Claimed])
    _ <- repo.curation.seal(lease.fence, scope, id)
    frozen <- repo.curation.frozen(settings.principal, scope, id)
    _ = assertEquals(frozen.material.input.sources.map(_.frontier), List(1L, 2L))
    _ = assertEquals(frozen.claim.previousCoveredFrontier, 0L)
    status <- repo.curation.status(settings.principal, scope)
    _ = assertEquals(status.coveredFrontier, 0L)
    _ = assertEquals(status.attempt.map(_.frontier), Some(2L))
  } yield () } } }

  for (nonempty <- List(false, true)) test(s"publication is atomic and replayable with nonempty=$nonempty") { check { (repo, settings, scope) =>
    for {
      _ <- capture(repo, scope)
      before <- repo.read(scope)
      retained <- leased(repo) { lease => for {
        value <- begin(repo, settings, scope, lease, if (nonempty) List(Operation.Create("summary", ApplicabilityInput.Unresolved("Fixture", Nil, Nil), ContentInput.Statement("Controlled interpretation", Modality.Assertion), Nil)) else Nil)
        _ <- observe(repo, scope, lease, value)
        result <- repo.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID())
        receipt = published(result)
        _ = assertEquals(result, CurationWriteResult.Published(receipt, false))
        graph <- repo.read(scope)
        _ = assertEquals(graph.generation, before.generation + 1L)
        _ = assertEquals((graph.sourceFrontier, graph.coveredFrontier), (1L, 1L))
        _ = if (!nonempty) assertEquals(graph, before.copy(generation = receipt.generation, coveredFrontier = 1L))
        _ = assertEquals(graph.definitions.size, before.definitions.size + (if (nonempty) 1 else 0))
        input <- repo.input(scope, receipt.input)
        _ = assertEquals(input.kind, InputKind.Curation)
        history <- repo.history(scope, receipt.generation)
        _ = assertEquals(history, graph)
        projections <- repo.outboxSnapshots(10000)
        _ = assert(projections.exists(g => g.scope == scope && g.generation == receipt.generation))
        status <- repo.curation.status(settings.principal, scope)
        _ = assertEquals(status.state, CurationState.Idle)
        _ = assertEquals(status.lastPublicationGeneration, Some(receipt.generation))
        _ <- mutate(repo, scope)
      } yield (lease.fence, value, receipt) }
      (fence, value, receipt) = retained
      replay <- repo.curation.publish(fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID())
      _ = assertEquals(replay, CurationWriteResult.Published(receipt, true))
      conflict <- repo.curation.publish(fence, scope, value.attempt.claim.attemptId, value.candidate.copy(responseDigest = "c" * 64), UUID.randomUUID()).attempt
      _ = fault(conflict, "replay-conflict")
      finalHead <- repo.read(scope)
      _ = assertEquals(finalHead.generation, receipt.generation + 1L)
      _ = assertEquals(finalHead.sourceFrontier, 2L)
      _ = assertEquals(finalHead.coveredFrontier, 1L)
    } yield ()
  } }
  test("a head change before preparation persists Stale without recording possible dispatch") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    id = UUID.randomUUID()
    _ <- repo.curation.claim(lease.fence, scope, id, profile)
    _ <- repo.curation.seal(lease.fence, scope, id)
    _ <- mutate(repo, scope)
    body = payload(Json.obj("notDispatched" -> Json.True))
    result <- repo.curation.appendAudit(lease.fence, scope, id, 1, CurationAuditStage.RequestPrepared, body.digest, Some(body))
    _ = assert(result.isInstanceOf[CurationWriteResult.Terminal])
    stored <- repo.curation.inspect(settings.principal, scope, id)
    _ = assertEquals(stored.attempt.state, CurationAttemptState.Stale)
    _ = assertEquals(stored.journal, Nil)
    graph <- repo.read(scope)
    _ = assertEquals((graph.sourceFrontier, graph.coveredFrontier), (2L, 0L))
  } yield () } } }

  test("a response after a head change is retained but cannot advance coverage") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    value <- begin(repo, settings, scope, lease, Nil)
    _ <- capture(repo, scope)
    _ <- observe(repo, scope, lease, value)
    result <- repo.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID())
    _ = assert(result.isInstanceOf[CurationWriteResult.Terminal])
    stored <- repo.curation.inspect(settings.principal, scope, value.attempt.claim.attemptId)
    _ = assertEquals(stored.attempt.state, CurationAttemptState.Stale)
    _ = assertEquals(stored.journal.map(_.stage), List(CurationAuditStage.RequestPrepared, CurationAuditStage.DispatchPossible, CurationAuditStage.ResponseObserved))
    _ = assert(!stored.attempt.auditUncertain)
    graph <- repo.read(scope)
    _ = assertEquals((graph.generation, graph.sourceFrontier, graph.coveredFrontier), (2L, 2L, 0L))
    next <- repo.curation.claim(lease.fence, scope, UUID.randomUUID(), profile)
    _ = assert(next.isInstanceOf[CurationClaimResult.Claimed])
  } yield () } } }

  test("domain rejection commits a terminal result without a partial graph or input publication") { check { (repo, settings, scope) => leased(repo) { lease => for {
    source <- capture(repo, scope)
    before <- repo.read(scope)
    operations = List(Operation.Create("first", ApplicabilityInput.Unresolved("Fixture", Nil, Nil), ContentInput.Statement("Should not remain", Modality.Assertion), Nil),
      Operation.Revise("protected", source.source, ApplicabilityInput.Unresolved("Fixture", Nil, Nil), ContentInput.Statement("Cannot replace source", Modality.Assertion), Standing.Active, List(Target.Exact(source.source)), "Controlled rejection"))
    value <- begin(repo, settings, scope, lease, operations)
    _ <- observe(repo, scope, lease, value)
    result <- repo.curation.publish(lease.fence, scope, value.attempt.claim.attemptId, value.candidate, UUID.randomUUID())
    _ = assert(result.isInstanceOf[CurationWriteResult.Terminal])
    stored <- repo.curation.inspect(settings.principal, scope, value.attempt.claim.attemptId)
    _ = assertEquals(stored.attempt.state, CurationAttemptState.Failed)
    _ = assertEquals(stored.attempt.terminalCode, Some("protected"))
    after <- repo.read(scope)
    _ = assertEquals(after, before)
    missing <- repo.input(scope, CurationIdentity.input(scope, value.attempt.claim.attemptId)).attempt
    _ = fault(missing, "not-found")
  } yield () } } }

  test("new-owner recovery preserves dispatch uncertainty and does not retry the same frontier") { check { (repo, settings, scope) => for {
    _ <- capture(repo, scope)
    retained <- leased(repo)(lease => begin(repo, settings, scope, lease, Nil).map(value => (lease, value)))
    (old, value) = retained
    _ <- leased(repo) { lease => for {
      recovered <- repo.curation.recoverOlderFences(lease.fence, 1)
      _ = assertEquals(recovered.attempts.map(_.attemptId), List(value.attempt.claim.attemptId))
      _ = assert(!recovered.more)
      stored <- repo.curation.inspect(settings.principal, scope, value.attempt.claim.attemptId)
      _ = assertEquals(stored.attempt.state, CurationAttemptState.Interrupted)
      _ = assert(stored.attempt.auditUncertain)
      replay <- repo.curation.appendAudit(old.fence, scope, value.attempt.claim.attemptId, 1, CurationAuditStage.DispatchPossible, value.request.digest, None)
      _ = assertEquals(replay, CurationWriteResult.Advanced(stored.attempt, true))
      late <- repo.curation.appendAudit(old.fence, scope, value.attempt.claim.attemptId, 1, CurationAuditStage.ResponseObserved, value.request.digest, Some(value.response))
      _ = assertEquals(late, CurationWriteResult.Terminal(stored.attempt))
      same <- repo.curation.claim(lease.fence, scope, UUID.randomUUID(), profile)
      _ = assert(same.isInstanceOf[CurationClaimResult.Ineligible])
      _ <- capture(repo, scope)
      fresh <- repo.curation.claim(lease.fence, scope, UUID.randomUUID(), profile)
      _ = assert(fresh.isInstanceOf[CurationClaimResult.Claimed])
    } yield () }
  } yield () } }

  test("later publication does not alter an earlier graph cut or its frozen input") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    before <- repo.read(scope)
    first <- begin(repo, settings, scope, lease, Nil)
    _ <- observe(repo, scope, lease, first)
    a <- repo.curation.publish(lease.fence, scope, first.attempt.claim.attemptId, first.candidate, UUID.randomUUID())
    firstGraph <- repo.read(scope)
    _ <- capture(repo, scope)
    second <- begin(repo, settings, scope, lease, Nil)
    _ <- observe(repo, scope, lease, second)
    b <- repo.curation.publish(lease.fence, scope, second.attempt.claim.attemptId, second.candidate, UUID.randomUUID())
    original <- repo.history(scope, before.generation)
    old <- repo.history(scope, published(a).generation)
    frozen <- repo.curation.frozen(settings.principal, scope, first.attempt.claim.attemptId)
    _ = assertEquals(original, before)
    _ = assertEquals(old, firstGraph)
    _ = assertEquals(frozen.snapshot, before)
    _ = assertEquals(frozen.material.input.sources.map(_.frontier), List(1L))
    status <- repo.curation.status(settings.principal, scope)
    _ = assertEquals((status.frontier, status.coveredFrontier), (2L, 2L))
    _ = assertEquals(status.lastPublicationGeneration, Some(published(b).generation))
  } yield () } } }

  test("repository audit adapter retains the exact request digest through all stages") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    frozen <- sealedView(repo, settings, scope, lease)
    audit <- RepositoryCurationAudit.create(repo.curation, frozen)
    request = preparedRequest(frozen)
    proposal = CurationProposal(frozen.claim.baseGeneration, frozen.claim.frontier, Nil)
    response = Json.obj("choices" -> Json.arr(Json.obj("finish_reason" -> Json.fromString("stop"), "message" -> Json.obj(
      "role" -> Json.fromString("assistant"), "content" -> Json.fromString(StoredJson.encode(CurationProposal.codecJson, proposal))))))
    _ <- audit.request(1, request)
    _ <- audit.dispatchPossible(1)
    possible <- repo.curation.inspect(settings.principal, scope, frozen.claim.attemptId)
    _ = assert(possible.attempt.auditUncertain)
    _ <- audit.response(1, response)
    observed <- repo.curation.inspect(settings.principal, scope, frozen.claim.attemptId)
    _ = assertEquals(observed.journal.map(_.requestDigest).distinct, List(Digests.text(request.noSpaces)))
    _ = assertEquals(observed.journal.map(_.stage), List(CurationAuditStage.RequestPrepared, CurationAuditStage.DispatchPossible, CurationAuditStage.ResponseObserved))
    candidate = CurationCandidate(frozen.claim.attemptId, frozen.material.manifest.inputDigest, 1, Digests.text(response.noSpaces), proposal, Digests.text(StoredJson.encode(CurationProposal.codecJson, proposal)))
    result <- repo.curation.publish(lease.fence, scope, frozen.claim.attemptId, candidate, UUID.randomUUID())
    _ = assertEquals(published(result).coveredFrontier, 1L)
  } yield () } } }

  test("replayed preparation is not permission for another dispatch") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    value <- begin(repo, settings, scope, lease, Nil)
    frozen <- repo.curation.frozen(settings.principal, scope, value.attempt.claim.attemptId)
    audit <- RepositoryCurationAudit.create(repo.curation, frozen)
    replay <- audit.request(1, io.circe.parser.parse(value.request.content).toOption.get).attempt
    _ = fault(replay, "curator-audit-replay")
    halted <- audit.dispatchPossible(1).attempt
    _ = fault(halted, "curator-audit")
    retained <- repo.curation.inspect(settings.principal, scope, value.attempt.claim.attemptId)
    _ = assertEquals(retained.journal.size, 2)
    _ = assert(retained.attempt.auditUncertain)
  } yield () } } }

  test("a stale terminal outcome halts the adapter without replacing that outcome") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    frozen <- sealedView(repo, settings, scope, lease)
    audit <- RepositoryCurationAudit.create(repo.curation, frozen)
    _ <- mutate(repo, scope)
    stopped <- audit.request(1, preparedRequest(frozen)).attempt
    _ = fault(stopped, "curator-terminal")
    retained <- repo.curation.inspect(settings.principal, scope, frozen.claim.attemptId)
    _ = assertEquals(retained.attempt.state, CurationAttemptState.Stale)
    _ = assertEquals(retained.journal, Nil)
  } yield () } } }

  for (afterCommit <- List(false, true)) test(s"failed audit acknowledgment stops the invocation with afterCommit=$afterCommit") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    frozen <- sealedView(repo, settings, scope, lease)
    calls <- cats.effect.Ref.of[IO, Int](0)
    writer = new CurationAuditWriter {
      def appendAudit(fence: CoordinatorFence, value: String, id: UUID, ordinal: Int, stage: CurationAuditStage, digest: String, body: Option[CurationAuditPayload]): IO[CurationWriteResult] =
        calls.update(_ + 1) *> (if (afterCommit) repo.curation.appendAudit(fence, value, id, ordinal, stage, digest, body).void else IO.unit) *>
          IO.raiseError(new java.io.IOException("controlled audit acknowledgment failure"))
    }
    audit <- RepositoryCurationAudit.create(writer, frozen)
    failed <- audit.request(1, preparedRequest(frozen)).attempt
    _ = assert(failed.left.toOption.exists(_.isInstanceOf[java.io.IOException]))
    repeated <- audit.request(1, preparedRequest(frozen)).attempt
    _ = fault(repeated, "curator-audit")
    count <- calls.get
    _ = assertEquals(count, 1)
    retained <- repo.curation.inspect(settings.principal, scope, frozen.claim.attemptId)
    _ = assertEquals(retained.journal.size, if (afterCommit) 1 else 0)
    _ = assert(!retained.attempt.auditUncertain)
  } yield () } } }

  test("cancelled audit hook cannot later authorize dispatch") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    frozen <- sealedView(repo, settings, scope, lease)
    entered <- cats.effect.Deferred[IO, Unit]
    writer = new CurationAuditWriter {
      def appendAudit(fence: CoordinatorFence, value: String, id: UUID, ordinal: Int, stage: CurationAuditStage, digest: String, body: Option[CurationAuditPayload]): IO[CurationWriteResult] =
        entered.complete(()).void *> IO.never[CurationWriteResult]
    }
    audit <- RepositoryCurationAudit.create(writer, frozen)
    fiber <- audit.request(1, preparedRequest(frozen)).start
    _ <- entered.get
    _ <- fiber.cancel
    stopped <- audit.dispatchPossible(1).attempt
    _ = fault(stopped, "curator-audit")
    retained <- repo.curation.inspect(settings.principal, scope, frozen.claim.attemptId)
    _ = assertEquals(retained.journal, Nil)
  } yield () } } }

  test("a queued preparation cannot start a new write after the preceding hook fails") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    frozen <- sealedView(repo, settings, scope, lease)
    entered <- cats.effect.Deferred[IO, Unit]
    release <- cats.effect.Deferred[IO, Unit]
    calls <- cats.effect.Ref.of[IO, Int](0)
    writer = new CurationAuditWriter {
      def appendAudit(fence: CoordinatorFence, value: String, id: UUID, ordinal: Int, stage: CurationAuditStage, digest: String, body: Option[CurationAuditPayload]): IO[CurationWriteResult] =
        calls.updateAndGet(_ + 1).flatMap { count =>
          if (count == 1) entered.complete(()).void *> release.get *> IO.raiseError(new java.io.IOException("controlled preparation failure"))
          else repo.curation.appendAudit(fence, value, id, ordinal, stage, digest, body)
        }
    }
    audit <- RepositoryCurationAudit.create(writer, frozen)
    _ <- Resource.make(audit.request(1, preparedRequest(frozen)).attempt.start)(fiber => release.complete(()).void *> fiber.cancel).use { first =>
      entered.get *> Resource.make(audit.request(1, preparedRequest(frozen)).attempt.start)(fiber => release.complete(()).void *> fiber.cancel).use { queued => for {
        _ <- IO.sleep(100.millis)
        _ <- release.complete(())
        failed <- first.joinWithNever
        rejected <- queued.joinWithNever
        _ = assert(failed.left.toOption.exists(_.isInstanceOf[java.io.IOException]))
        _ = fault(rejected, "curator-audit")
        count <- calls.get
        _ = assertEquals(count, 1)
        retained <- repo.curation.inspect(settings.principal, scope, frozen.claim.attemptId)
        _ = assertEquals(retained.journal, Nil)
      } yield () }
    }
  } yield () } } }

  test("cancelling a queued callback prevents an in-flight hook from returning dispatch authorization") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    frozen <- sealedView(repo, settings, scope, lease)
    entered <- cats.effect.Deferred[IO, Unit]
    release <- cats.effect.Deferred[IO, Unit]
    writer = new CurationAuditWriter {
      def appendAudit(fence: CoordinatorFence, value: String, id: UUID, ordinal: Int, stage: CurationAuditStage, digest: String, body: Option[CurationAuditPayload]): IO[CurationWriteResult] = {
        val gate = if (stage == CurationAuditStage.DispatchPossible) entered.complete(()).void *> release.get else IO.unit
        gate *> repo.curation.appendAudit(fence, value, id, ordinal, stage, digest, body)
      }
    }
    audit <- RepositoryCurationAudit.create(writer, frozen)
    _ <- audit.request(1, preparedRequest(frozen))
    _ <- Resource.make(audit.dispatchPossible(1).attempt.start)(fiber => release.complete(()).void *> fiber.cancel).use { holder =>
      entered.get *> Resource.make(audit.request(2, preparedRequest(frozen)).start)(_.cancel).use { waiting => for {
        _ <- IO.sleep(100.millis)
        _ <- waiting.cancel
        _ <- release.complete(())
        authorization <- holder.joinWithNever
        stopped <- audit.response(1, Json.obj()).attempt
        _ = assertEquals(stopped.left.toOption.collect { case error: Fault => error.detail }, Some("audit invocation has stopped"), "fixture must observe the stopped invocation")
        _ = fault(authorization, "curator-audit")
        retained <- repo.curation.inspect(settings.principal, scope, frozen.claim.attemptId)
        _ = assertEquals(retained.journal.size, 2)
        _ = assert(retained.attempt.auditUncertain)
      } yield () }
    }
  } yield () } } }

  test("curator reader pages and receipt access stay on the exact frozen generation") { check { (repo, settings, scope) => leased(repo) { lease => for {
    _ <- capture(repo, scope)
    id = UUID.randomUUID()
    _ <- repo.curation.claim(lease.fence, scope, id, profile)
    _ <- repo.curation.seal(lease.fence, scope, id)
    frozen <- repo.curation.frozen(settings.principal, scope, id)
    reader = new FrozenCurationReader(frozen, repo, settings.principal, new CursorSigner(Array.fill[Byte](32)(1)), QueryLimits(100, 64, 65536, 2048))
    request = ReadRequest(scope, ReadView.History, Nil, None, 1)
    first <- reader.read(request)
    _ = assert(first.cursor.nonEmpty)
    _ <- capture(repo, scope)
    _ <- mutate(repo, scope)
    rest <- {
      def all(cursor: Option[String], records: List[GraphRecord]): IO[List[GraphRecord]] = cursor match {
        case None => IO.pure(records)
        case Some(value) => reader.read(request.copy(cursor = Some(value))).flatMap { page =>
          assertEquals(page.generation, frozen.claim.baseGeneration)
          all(page.cursor, records ++ page.records)
        }
      }
      all(first.cursor, first.records)
    }
    _ = assertEquals(rest.toSet, Graph.records(frozen.snapshot).toSet)
    _ = assertEquals(rest.distinct.size, rest.size)
    absent <- reader.find(FindRequest(scope, None, "An ordinary graph edit", None, 10))
    _ = assertEquals(absent.items, Nil)
    oldInput = Ref(frozen.material.input.sources.head.provenance.input, 1)
    older <- reader.read(ReadRequest(scope, ReadView.History, List(oldInput), None, 10))
    _ = assert(older.records.exists { case GraphRecord.Input(value) => value.ref == oldInput; case _ => false })
    newer <- repo.sources(SourceRequest(scope, frozen.claim.frontier, 10))
    denied <- reader.read(ReadRequest(scope, ReadView.History, List(Ref(newer.events.head.provenance.input, 1)), None, 10)).attempt
    _ = fault(denied, "stale-reference")
    foreign <- reader.find(FindRequest(scope + "-other", None, "", None, 10)).attempt
    _ = fault(foreign, "curator-snapshot")
    miswired = new GraphReadRepository {
      def read(value: String): IO[GraphSnapshot] = IO.raiseError(new AssertionError("Frozen reader must not consult a live head"))
      def input(value: String, ref: Ref): IO[InputReceipt] = repo.input(value, ref).map(_.copy(ref = Ref(UUID.randomUUID(), 1)))
    }
    miswiredReader = new FrozenCurationReader(frozen, miswired, settings.principal, new CursorSigner(Array.fill[Byte](32)(1)), QueryLimits(100, 64, 65536, 2048))
    wrongReceipt <- miswiredReader.read(ReadRequest(scope, ReadView.History, List(oldInput), None, 10)).attempt
    _ = fault(wrongReceipt, "stale-reference")
    _ = assertEquals(intercept[Fault](new FrozenCurationReader(frozen.copy(material = frozen.material.copy(input = frozen.material.input.copy(seed = Nil))), repo,
      settings.principal, new CursorSigner(Array.fill[Byte](32)(1)), QueryLimits(100, 64, 65536, 2048))).code, "curation")
  } yield () } } }

  test("read authorization precedes discovery and scan bounds are enforced") { check { (repo, settings, scope) => leased(repo) { lease =>
    val denied = settings.principal.copy(scopes = Set("elsewhere"))
    for {
      a <- repo.curation.inspect(denied, scope, UUID.randomUUID()).attempt
      b <- repo.curation.frozen(denied, scope, UUID.randomUUID()).attempt
      c <- repo.curation.status(denied, scope).attempt
      _ = List(a, b, c).foreach(value => fault(value, "forbidden"))
      zero <- repo.curation.eligibleScopes(lease.fence, 0).attempt
      large <- repo.curation.recoverOlderFences(lease.fence, settings.maxRecoveryAttempts + 1).attempt
      _ = fault(zero, "limit")
      _ = fault(large, "limit")
    } yield ()
  } } }
}

final class MemoryCurationRepositorySuite extends CurationRepositoryContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] =
    Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine, TestReview.domain, settings, java.time.Clock.systemUTC())))
}
final class PostgresCurationRepositorySuite extends CurationRepositoryContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = RepositoryReproductionDatabase.resource.evalMap { db =>
    val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
    repo.initialize.as(repo: GraphRepository)
  }
}
