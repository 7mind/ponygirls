package ontology

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import java.util.UUID
import ontology.api.*
import ontology.domain.*

abstract class CapsuleRepositoryContract extends CurationRepositorySupport {
  private val contextName = "controlled-work"
  private val native = ContextRecordInput(OriginContextInput.ReportedNative(CaptureContext("fixture-session", None, None, LineageStatus.Unknown, "fixture-branch", UUID.randomUUID())), Nil)
  private def config(scope: String): CapsuleStoreSettings = CapsuleStoreSettings(CapsuleSettings(Set(WorkContextKey(scope, contextName)), CapsuleLimits(256, 1048576)), 4, 8)
  private def call(settings: CurationStoreSettings, operation: String): ServiceCall = ServiceCall.internal(settings.principal.copy(capabilities = Set(Capability.Read)), operation, UUID.randomUUID())
  private def request(scope: String, frontier: Long, previous: Option[UUID]): CapsuleRequest = CapsuleRequest(scope, UUID.randomUUID(), contextName, Some(native), frontier, previous)
  private def delivery(value: Capsule): DeliveryRequest = DeliveryRequest(value.payload.scope, UUID.randomUUID(), value.id, value.payloadDigest,
    contextName, Some(native), DeliveryBoundary.ExtensionContext, None, Some(ReportedBoundaryDigest("controlled-context-json", "a" * 64)))

  test("empty G0 capsule persists across facades without creating graph history or primary activity") { check { (repo, settings, scope) => for {
    before <- repo.read(scope)
    r = request(scope, 0L, None)
    first <- repo.capsules(config(scope)).prepare(r, call(settings, "capsule.prepare"), UUID.randomUUID())
    stored <- repo.capsules(config(scope)).capsule(settings.principal, scope, first.id)
    replay <- repo.capsules(config(scope)).prepare(r, call(settings, "capsule.retry"), UUID.randomUUID())
    after <- repo.read(scope)
    scopes <- repo.scopes
    history <- repo.history(scope, 0L).attempt
    sources <- repo.sources(SourceRequest(scope, 0L, 10))
    _ = assertEquals(stored, first)
    _ = assertEquals(replay, first)
    _ = assertEquals(after, before)
    _ = assert(!scopes.contains(scope))
    _ = fault(history, "not-found")
    _ = assertEquals(sources.events, Nil)
    _ = assertEquals(first.payload.cut, CapsuleCut(0L, 0L, 0L, None, None))
  } yield () } }

  test("preparation replay preserves original cut and trace despite later primary activity and credential rotation") { check { (repo, settings, scope) => for {
    _ <- capture(repo, scope)
    r = request(scope, 1L, None)
    originalCall = call(settings, "capsule.prepare")
    first <- repo.capsules(config(scope)).prepare(r, originalCall, UUID.randomUUID())
    _ <- mutate(repo, scope)
    rotated = ServiceCall.internal(settings.principal.copy(credentialId = "rotated", capabilities = Set(Capability.Read)), "retry", UUID.randomUUID())
    replay <- repo.capsules(config(scope)).prepare(r, rotated, UUID.randomUUID())
    conflict <- repo.capsules(config(scope)).prepare(r.copy(expectedFrontier = 2L), rotated, UUID.randomUUID()).attempt
    graph <- repo.read(scope)
    _ = assertEquals(replay, first)
    _ = assertEquals(replay.preparationTrace, originalCall.ingress)
    _ = assertEquals(replay.payload.cut.frontier, 1L)
    _ = assertEquals(graph.sourceFrontier, 2L)
    _ = fault(conflict, "replay-conflict")
  } yield () } }

  test("ancestry limits include the new artifact and retained limits survive configuration reduction") { check { (repo, settings, scope) => for {
    cfg = config(scope).copy(maxBaselineChain = 2, maxMaterialSnapshots = 1)
    first <- repo.capsules(cfg).prepare(request(scope, 0L, None), call(settings, "prepare"), UUID.randomUUID())
    second <- repo.capsules(cfg).prepare(request(scope, 0L, Some(first.id)), call(settings, "prepare"), UUID.randomUUID())
    thirdId = UUID.randomUUID()
    tooDeep <- repo.capsules(cfg).prepare(request(scope, 0L, Some(second.id)), call(settings, "prepare"), thirdId).attempt
    missing <- repo.capsules(cfg).capsule(settings.principal, scope, thirdId).attempt
    retained <- repo.capsules(cfg.copy(projection = cfg.projection.copy(limits = CapsuleLimits(1, 1)))).capsule(settings.principal, scope, second.id)
    reduced <- repo.capsules(cfg.copy(maxBaselineChain = 1)).capsule(settings.principal, scope, second.id).attempt
    _ = fault(tooDeep, "capacity")
    _ = fault(missing, "not-found")
    _ = fault(reduced, "capacity")
    _ = assertEquals(retained, second)
  } yield () } }

  test("a stale fresh request is rejected before projecting an oversized current cut") { check { (repo, settings, scope) => for {
    _ <- capture(repo, scope)
    cfg = config(scope).copy(projection = config(scope).projection.copy(limits = CapsuleLimits(1, 1048576)))
    id = UUID.randomUUID()
    stale <- repo.capsules(cfg).prepare(request(scope, 0L, None), call(settings, "prepare"), id).attempt
    absent <- repo.capsules(config(scope)).capsule(settings.principal, scope, id).attempt
    _ = fault(stale, "stale-frontier")
    _ = fault(absent, "not-found")
  } yield () } }

  test("material budget counts distinct assembly cuts and refuses partial preparation") { check { (repo, settings, scope) => for {
    _ <- capture(repo, scope)
    cfg = config(scope).copy(maxMaterialSnapshots = 1)
    first <- repo.capsules(cfg).prepare(request(scope, 1L, None), call(settings, "prepare"), UUID.randomUUID())
    _ <- mutate(repo, scope)
    id = UUID.randomUUID()
    failed <- repo.capsules(cfg).prepare(request(scope, 2L, Some(first.id)), call(settings, "prepare"), id).attempt
    missing <- repo.capsules(config(scope)).capsule(settings.principal, scope, id).attempt
    next <- repo.capsules(cfg.copy(maxMaterialSnapshots = 2)).prepare(request(scope, 2L, Some(first.id)), call(settings, "prepare"), UUID.randomUUID())
    stored <- repo.capsules(cfg.copy(maxMaterialSnapshots = 2)).capsule(settings.principal, scope, next.id)
    _ = fault(failed, "capacity")
    _ = fault(missing, "not-found")
    _ = assertEquals(stored, next)
    _ = assertEquals(stored.payload.previousCapsuleId, Some(first.id))
  } yield () } }

  test("disabled new context still permits retained preparation replay and delayed delivery") { check { (repo, settings, scope) => for {
    _ <- capture(repo, scope)
    cfg = config(scope)
    r = request(scope, 1L, None)
    first <- repo.capsules(cfg).prepare(r, call(settings, "prepare"), UUID.randomUUID())
    _ <- mutate(repo, scope)
    disabled = cfg.copy(projection = cfg.projection.copy(contexts = Set(WorkContextKey(scope, "different-context"))))
    rejected <- repo.capsules(disabled).prepare(request(scope, 2L, None), call(settings, "prepare"), UUID.randomUUID()).attempt
    replay <- repo.capsules(disabled).prepare(r, call(settings, "retry"), UUID.randomUUID())
    d = delivery(first)
    received <- repo.capsules(disabled).recordDelivery(d, call(settings, "delivery"), UUID.randomUUID())
    _ <- mutate(repo, scope)
    before <- repo.read(scope)
    again <- repo.capsules(disabled).recordDelivery(d, call(settings, "delivery-retry"), UUID.randomUUID())
    stored <- repo.capsules(disabled).delivery(settings.principal, scope, received.id)
    after <- repo.read(scope)
    _ = fault(rejected, "work-context")
    _ = assertEquals(replay, first)
    _ = assertEquals(received.cutComparison, DeliveryCutComparison.ChangedGraphOrCoverage)
    _ = assertEquals(received.observedCut.frontier, 2L)
    _ = assertEquals(again, received)
    _ = assertEquals(stored, received)
    _ = assertEquals(after, before)
  } yield () } }

  test("same-key concurrency creates one retained preparation and one reported delivery") { check { (repo, settings, scope) => for {
    r = request(scope, 0L, None)
    prepared <- List.fill(5)(IO(UUID.randomUUID()).flatMap(id => repo.capsules(config(scope)).prepare(r, call(settings, "prepare"), id))).parSequence
    _ = assert(prepared.forall(_ == prepared.head))
    d = delivery(prepared.head)
    received <- List.fill(5)(IO(UUID.randomUUID()).flatMap(id => repo.capsules(config(scope)).recordDelivery(d, call(settings, "delivery"), id))).parSequence
    _ = assert(received.forall(_ == received.head))
    graph <- repo.read(scope)
    _ = assertEquals(graph, Graph.empty(scope))
  } yield () } }

  test("retained owner and currently authorized inherited namespaces precede historical lookups") { check { (repo, settings, scope) => for {
    cfg = config(scope)
    deniedContext = native.copy(reportedInherited = List(ReportedInheritance(InheritanceKind.Import, "not-authorized", 99L, 0L, 0L, Nil, Nil, None)))
    denied <- repo.capsules(cfg).prepare(request(scope, 0L, None).copy(reportedContext = Some(deniedContext)), call(settings, "prepare"), UUID.randomUUID()).attempt
    _ = fault(denied, "forbidden")
    foreign = native.copy(reportedInherited = List(ReportedInheritance(InheritanceKind.Import, scope + "-other", 0L, 0L, 0L, Nil, Nil, None)))
    first <- repo.capsules(cfg).prepare(request(scope, 0L, None).copy(reportedContext = Some(foreign)), call(settings, "prepare"), UUID.randomUUID())
    limited = settings.principal.copy(scopes = Set(scope))
    revoked <- repo.capsules(cfg).capsule(limited, scope, first.id).attempt
    child <- repo.capsules(cfg).prepare(request(scope, 0L, Some(first.id)), ServiceCall.internal(limited, "prepare", UUID.randomUUID()), UUID.randomUUID()).attempt
    other <- repo.capsules(cfg).capsule(settings.principal.copy(actor = Actor("another-owner", ActorKind.Agent)), scope, first.id).attempt
    _ = fault(revoked, "forbidden")
    _ = fault(child, "forbidden")
    _ = fault(other, "forbidden")
  } yield () } }

  test("retained running-attempt observations survive later curation publication without being rewritten") { check { (repo, settings, scope) =>
    capture(repo, scope) *> leased(repo) { lease => for {
      attempt <- begin(repo, settings, scope, lease, Nil)
      r = request(scope, 1L, None)
      before <- repo.capsules(config(scope)).prepare(r, call(settings, "prepare"), UUID.randomUUID())
      _ = assertEquals(before.payload.cut.attempt.map(_.state), Some(CurationAttemptState.Running))
      _ = assertEquals(before.payload.cut.attempt.flatMap(_.lastStage), Some(CurationAuditStage.DispatchPossible))
      _ = assertEquals(before.payload.cut.attempt.map(_.auditUncertain), Some(true))
      _ <- observe(repo, scope, lease, attempt)
      result <- repo.curation.publish(lease.fence, scope, attempt.attempt.claim.attemptId, attempt.candidate, UUID.randomUUID())
      _ = published(result)
      retained <- repo.capsules(config(scope)).capsule(settings.principal, scope, before.id)
      replay <- repo.capsules(config(scope)).prepare(r, call(settings, "retry"), UUID.randomUUID())
      after <- repo.capsules(config(scope)).prepare(request(scope, 1L, Some(before.id)), call(settings, "prepare"), UUID.randomUUID())
      _ = assertEquals(retained, before)
      _ = assertEquals(replay, before)
      _ = assertEquals(after.payload.cut.coveredFrontier, 1L)
      _ = assertEquals(after.payload.cut.attempt.map(_.state), Some(CurationAttemptState.Published))
    } yield () }
  } }

  test("an explicit Unknown baseline or changed delivery payload is rejected rather than silently rebound") { check { (repo, settings, scope) => for {
    cfg = config(scope)
    unknown <- repo.capsules(cfg).prepare(request(scope, 0L, None).copy(reportedContext = None), call(settings, "prepare"), UUID.randomUUID())
    invalid <- repo.capsules(cfg).prepare(request(scope, 0L, Some(unknown.id)).copy(reportedContext = None), call(settings, "prepare"), UUID.randomUUID()).attempt
    _ = fault(invalid, "context")
    first <- repo.capsules(cfg).prepare(request(scope, 0L, None), call(settings, "prepare"), UUID.randomUUID())
    d = delivery(first)
    received <- repo.capsules(cfg).recordDelivery(d, call(settings, "delivery"), UUID.randomUUID())
    changed <- repo.capsules(cfg).recordDelivery(d.copy(reportedBoundaryPayload = None), call(settings, "retry"), UUID.randomUUID()).attempt
    _ = fault(changed, "replay-conflict")
    retained <- repo.capsules(cfg).delivery(settings.principal, scope, received.id)
    _ = assertEquals(retained, received)
  } yield () } }
}
final class MemoryCapsuleRepositorySuite extends CapsuleRepositoryContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine, TestReview.domain, settings, java.time.Clock.systemUTC())))
}
final class PostgresCapsuleRepositorySuite extends CapsuleRepositoryContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = RepositoryReproductionDatabase.resource.evalMap { db =>
    val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
    repo.initialize.as(repo: GraphRepository)
  }
}
