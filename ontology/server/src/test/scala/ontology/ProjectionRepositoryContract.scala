package ontology

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import java.util.UUID
import ontology.api.*
import ontology.domain.*

private[ontology] final case class AcceptedProjection(input: ProjectionAckInput, observation: ProjectionObservation, result: ProjectionAckResult)
abstract class ProjectionRepositoryContract extends CurationRepositorySupport {
  private val target = "controlled-projection"
  private def config(settings: CurationStoreSettings, batch: Int): ProjectionSettings = ProjectionSettings(
    Principal("projector", Actor("projector", ActorKind.Service), settings.scopes, Set(Capability.Read)), target, settings.scopes, batch)
  private def rdf: Resource[IO, RdfProjection] = RdfProjection.resource(RdfStorage.Memory, target, 10, IO(UUID.randomUUID()))
  private def accept(owner: ProjectionRepository, projection: RdfProjection, session: ProjectionSession, work: ProjectionWork): IO[AcceptedProjection] = for {
    _ <- projection.publish(work.snapshot)
    observed <- projection.observe(work.target.scope).map(_.getOrElse(throw new AssertionError("projected cut missing")))
    input = ProjectionAckInput(session.id, UUID.randomUUID(), work.target, observed.checkpoint)
    result <- owner.acknowledge(input, observed)
  } yield AcceptedProjection(input, observed, result)
  private def reconcile(owner: ProjectionRepository, projection: RdfProjection, session: ProjectionSession): IO[List[AcceptedProjection]] = {
    def step(remaining: Int): IO[List[AcceptedProjection]] = IO.defer {
      Require(remaining > 0, "fixture", "reconciliation did not finish within configured scope count")
      owner.reconcileHeads(session.id).flatMap(batch => if (batch.reconciliationComplete) IO.pure(Nil)
        else batch.work.traverse(accept(owner, projection, session, _)).flatMap(values => step(remaining - 1).map(values ++ _)))
    }
    step(session.scopes.size + 1)
  }

  test("bounded acquisition reconciliation cannot skip unacknowledged empty scope heads") { check { (repo, settings, scope) => rdf.use { projection => leased(repo) { lease => for {
    owner = repo.projections(config(settings, 1))
    id = UUID.randomUUID()
    session <- owner.open(id, lease.fence, projection.instance)
    repeated <- owner.open(id, lease.fence, projection.instance)
    _ = assertEquals(repeated, session)
    duplicate <- owner.open(UUID.randomUUID(), lease.fence, projection.instance).attempt
    _ = fault(duplicate, "identity")
    blocked <- owner.pending(session.id).attempt
    _ = fault(blocked, "projection-progress")
    first <- owner.reconcileHeads(session.id)
    again <- owner.reconcileHeads(session.id)
    _ = assertEquals(again, first)
    _ = assertEquals(first.work.size, 1)
    _ = assertEquals(first.work.head.snapshot, Graph.empty(settings.scopes.toList.sorted.head))
    accepted <- accept(owner, projection, session, first.work.head)
    _ = assert(!accepted.result.replayed)
    second <- owner.reconcileHeads(session.id)
    _ = assertEquals(second.work.map(_.target.scope), settings.scopes.toList.sorted.drop(1))
    _ <- second.work.traverse(accept(owner, projection, session, _))
    ready <- owner.reconcileHeads(session.id)
    pending <- owner.pending(session.id)
    scopes <- repo.scopes
    _ = assert(ready.reconciliationComplete && ready.work.isEmpty)
    _ = assert(pending.reconciliationComplete && pending.work.isEmpty)
    _ = assert(!settings.scopes.exists(scopes.contains))
  } yield () } } } }

  test("issued heads stay pinned and original ACK replay remains readable after checkpoint advance and release") { check { (repo, settings, scope) => rdf.use { projection =>
    val owner = repo.projections(config(settings, 2))
    for {
      _ <- capture(repo, scope)
      retained <- leased(repo) { lease => for {
        session <- owner.open(UUID.randomUUID(), lease.fence, projection.instance)
        first <- owner.reconcileHeads(session.id)
        _ <- mutate(repo, scope)
        again <- owner.reconcileHeads(session.id)
        _ = assertEquals(again, first)
        acknowledged <- first.work.traverse(accept(owner, projection, session, _))
        ready <- owner.reconcileHeads(session.id)
        _ = assert(ready.reconciliationComplete)
        pending <- owner.pending(session.id)
        _ = assertEquals(pending.work.map(_.target.generation), List(2L))
        _ <- pending.work.traverse(accept(owner, projection, session, _))
        empty <- owner.pending(session.id)
        _ = assertEquals(empty.work, Nil)
        graph <- repo.read(scope)
        _ = assertEquals((graph.generation, graph.sourceFrontier, graph.coveredFrontier), (2L, 2L, 0L))
      } yield (session, acknowledged.find(_.input.target.scope == scope).get) }
      (session, original) = retained
      replay <- owner.acknowledge(original.input, original.observation)
      _ = assertEquals(replay, original.result.copy(replayed = true))
      receipt <- owner.receipt(settings.principal, scope, session.id, original.input.requestId)
      _ = assertEquals(receipt, Some(original.result.receipt))
      forbiddenNew <- owner.acknowledge(original.input.copy(requestId = UUID.randomUUID(), target = original.input.target.copy(origin = ProjectionTargetOrigin.Outbox)), original.observation).attempt
      _ = fault(forbiddenNew, "coordinator")
      stopped <- owner.pending(session.id).attempt
      _ = fault(stopped, "coordinator")
    } yield ()
  } } }

  test("new stale observations reject without lowering checkpoints and newer observations may supersede older targets") { check { (repo, settings, scope) => rdf.use { projection => leased(repo) { lease => for {
    owner = repo.projections(config(settings, 2))
    session <- owner.open(UUID.randomUUID(), lease.fence, projection.instance)
    _ <- reconcile(owner, projection, session)
    _ <- mutate(repo, scope)
    _ <- mutate(repo, scope)
    pending <- owner.pending(session.id)
    _ = assertEquals(pending.work.map(_.target.generation), List(1L, 2L))
    _ <- projection.publish(pending.work.head.snapshot)
    older <- projection.observe(scope).map(_.get)
    _ <- projection.publish(pending.work.last.snapshot)
    newer <- projection.observe(scope).map(_.get)
    high = ProjectionAckInput(session.id, UUID.randomUUID(), pending.work.last.target, newer.checkpoint)
    _ <- owner.acknowledge(high, newer)
    low = ProjectionAckInput(session.id, UUID.randomUUID(), pending.work.head.target, older.checkpoint)
    rejected <- owner.acknowledge(low, older).attempt
    _ = fault(rejected, "projection-stale")
    missing <- owner.receipt(settings.principal, scope, session.id, low.requestId)
    _ = assertEquals(missing, None)
    accepted <- owner.acknowledge(low.copy(requestId = UUID.randomUUID(), observed = newer.checkpoint), newer)
    _ = assertEquals(accepted.receipt.disposition, ProjectionDisposition.SupersededByCheckpoint)
    checkpoint <- owner.checkpoint(settings.principal, projection.instance, scope)
    _ = assertEquals(checkpoint, Some(newer.checkpoint))
    changedReplay <- owner.acknowledge(high.copy(target = pending.work.head.target), newer).attempt
    _ = fault(changedReplay, "replay-conflict")
  } yield () } } } }

  test("a fresh incarnation receives reconciliation despite another instance checkpoints") { check { (repo, settings, scope) => rdf.use { first => leased(repo) { lease =>
    val owner = repo.projections(config(settings, 1))
    for {
      original <- owner.open(UUID.randomUUID(), lease.fence, first.instance)
      _ <- reconcile(owner, first, original)
      _ <- rdf.use { second => for {
        _ = assert(first.instance != second.instance)
        absent <- owner.checkpoint(settings.principal, second.instance, scope)
        _ = assertEquals(absent, None)
        session <- owner.open(UUID.randomUUID(), lease.fence, second.instance)
        blocked <- owner.pending(session.id).attempt
        _ = fault(blocked, "projection-progress")
        heads <- owner.reconcileHeads(session.id)
        local <- second.observe(heads.work.head.target.scope)
        _ = assert(heads.work.nonEmpty && !heads.reconciliationComplete)
        _ = assertEquals(local, None)
      } yield () }
    } yield ()
  } } } }

  test("session batch limits stay pinned and mismatched observations publish no acknowledgment") { check { (repo, settings, scope) => rdf.use { projection => leased(repo) { lease => for {
    owner = repo.projections(config(settings, 1))
    session <- owner.open(UUID.randomUUID(), lease.fence, projection.instance)
    first <- owner.reconcileHeads(session.id)
    changed = repo.projections(config(settings, 2))
    repeated <- changed.reconcileHeads(session.id)
    _ = assertEquals(repeated, first)
    conflict <- changed.open(session.id, lease.fence, projection.instance).attempt
    _ = fault(conflict, "replay-conflict")
    _ <- projection.publish(first.work.head.snapshot)
    observed <- projection.observe(first.work.head.target.scope).map(_.get)
    input = ProjectionAckInput(session.id, UUID.randomUUID(), first.work.head.target, observed.checkpoint)
    invalid <- owner.acknowledge(input, observed.copy(snapshot = observed.snapshot.copy(scope = "wrong-scope"))).attempt
    _ = fault(invalid, "projection-observation")
    missing <- owner.receipt(settings.principal, input.target.scope, session.id, input.requestId)
    _ = assertEquals(missing, None)
    denied <- owner.receipt(settings.principal.copy(scopes = Set.empty), input.target.scope, session.id, input.requestId).attempt
    _ = fault(denied, "forbidden")
    still <- owner.reconcileHeads(session.id)
    _ = assertEquals(still, first)
  } yield () } } } }

  test("another acquisition must reconcile even when the same instance already has checkpoints") { check { (repo, settings, scope) => rdf.use { projection =>
    val owner = repo.projections(config(settings, 1))
    for {
      old <- leased(repo)(lease => owner.open(UUID.randomUUID(), lease.fence, projection.instance).flatTap(reconcile(owner, projection, _)))
      _ <- leased(repo) { lease => for {
        current <- owner.open(UUID.randomUUID(), lease.fence, projection.instance)
        _ = assert(current.fence != old.fence)
        blocked <- owner.pending(current.id).attempt
        _ = fault(blocked, "projection-progress")
        heads <- owner.reconcileHeads(current.id)
        _ = assertEquals(heads.work.map(_.target.scope), settings.scopes.toList.sorted.take(1))
        oldWork <- owner.reconcileHeads(old.id).attempt
        _ = fault(oldWork, "coordinator")
      } yield () }
    } yield ()
  } } }
}
final class MemoryProjectionRepositorySuite extends ProjectionRepositoryContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine, TestReview.domain, settings, java.time.Clock.systemUTC())))
}
final class PostgresProjectionRepositorySuite extends ProjectionRepositoryContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = RepositoryReproductionDatabase.resource.evalMap { db =>
    val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
    repo.initialize.as(repo: GraphRepository)
  }
}
