package ontology

import cats.effect.IO
import cats.syntax.all.*
import java.time.Clock
import java.util.UUID
import ontology.api.*
import ontology.domain.*

final class DefaultOntologyService(repository: GraphRepository, cursors: CursorSigner, queryLimits: QueryLimits,
  capsuleSettings: CapsuleStoreSettings, catalog: ScopeCatalog, rdf: ExactRdfReadiness, recorder: Actor, clock: Clock, ids: IO[UUID]) extends OntologyService {
  Require(recorder.kind == ActorKind.Service && recorder.id.trim.nonEmpty, "config", "configured service recorder required")
  private val queries = new GraphQueries(repository, cursors, queryLimits)
  private val capsules = repository.capsules(capsuleSettings)
  private def now: IO[String] = IO(clock.instant().toString)
  private def authorized[A](call: ServiceCall, scope: String, capability: Capability)(body: => IO[A]): IO[A] = IO.defer {
    call.principal.require(scope, capability)
    body
  }
  private def reviewed[A](call: ReviewCall, scope: String)(body: => IO[A]): IO[A] = IO.defer {
    Require(call.scope == scope, "forbidden", "review call scope differs")
    ReviewCall.from(call.call, scope)
    body
  }
  def limits(call: ServiceCall): IO[QueryLimitsResult] = IO {
    Require(call.principal.capabilities.contains(Capability.Read), "forbidden", "query limits require Read")
    QueryLimitsResult(queryLimits.maxPageRecords)
  }
  def scopes(call: ServiceCall): IO[ScopesResult] = IO.defer {
    Require(call.principal.capabilities.contains(Capability.Read), "forbidden", "scope catalog requires Read")
    catalog.scopes(call.principal).flatMap { scopes =>
      Require(scopes.distinct == scopes && scopes.forall(_.trim.nonEmpty), "invariant", "invalid scope catalog")
      scopes.foreach(call.principal.require(_, Capability.Read))
      scopes.sorted.traverse { scope => for {
        status <- repository.curation.status(call.principal, scope)
        graph <- if (status.generation == 0L) IO.pure(Graph.empty(scope)) else repository.history(scope, status.generation)
        _ = Require(graph.scope == scope && graph.generation == status.generation && graph.sourceFrontier == status.frontier && graph.coveredFrontier == status.coveredFrontier,
          "corrupt", "scope summary differs from authoritative cut")
        projected <- rdf.generation(graph)
        _ = Require(projected.forall(_ == graph.generation), "invariant", "exact RDF readiness returned another generation")
      } yield ScopeSummary(scope, status.generation, status.frontier, status.coveredFrontier, status.state, status.failure,
        projected, status.lastPublicationGeneration, status.attempt) }.map(ScopesResult(_))
    }
  }
  def find(call: ServiceCall, request: FindRequest): IO[FindResult] = authorized(call, request.scope, Capability.Read)(queries.find(call.principal, request))
  def read(call: ServiceCall, request: ReadRequest): IO[ReadResult] = authorized(call, request.scope, Capability.Read)(queries.read(call.principal, request))
  def sources(call: ServiceCall, request: SourceRequest): IO[SourceResult] = authorized(call, request.scope, Capability.Read)(repository.sources(request))
  def status(call: ServiceCall, request: ScopeRequest): IO[CurationStatus] = authorized(call, request.scope, Capability.Read)(repository.curation.status(call.principal, request.scope))
  def present(call: ReviewCall, request: PresentRequest): IO[Presentation] = reviewed(call, request.scope) {
    for { id <- ids; at <- now; result <- repository.prepare(request, call, id, at) } yield result
  }
  def judge(call: ReviewCall, request: JudgmentRequest): IO[Judgment] = reviewed(call, request.scope) {
    now.flatMap(at => repository.judge(request, call, recorder, at))
  }
  def judgments(call: ServiceCall, request: ScopeRequest): IO[JudgmentsResult] = authorized(call, request.scope, Capability.Read) {
    repository.judgments(call.principal, request.scope).map(JudgmentsResult(_))
  }
  def apply(call: ServiceCall, request: ApplyRequest): IO[ApplyResult] = authorized(call, request.scope, Capability.Mutate) {
    now.flatMap(at => repository.apply(request, Admission(call.principal, recorder, request.requestId, at, call.ingress, Nil)))
  }
  def ingest(call: ServiceCall, request: IngestRequest): IO[IngestResult] = authorized(call, request.scope, Capability.Capture) {
    now.flatMap(at => repository.ingest(request, call.principal, recorder, at, call.ingress))
  }
  def capsule(call: ServiceCall, request: CapsuleRequest): IO[Capsule] = authorized(call, request.scope, Capability.Read) {
    ids.flatMap(id => capsules.prepare(request, call, id))
  }
  def delivery(call: ServiceCall, request: DeliveryRequest): IO[DeliveryReceipt] = authorized(call, request.scope, Capability.Read) {
    ids.flatMap(id => capsules.recordDelivery(request, call, id))
  }
}
