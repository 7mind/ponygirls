package ontology

import cats.effect.IO
import ontology.api.*

/** Application boundary shared by REST and MCP. Implementations must recheck
  * credential-derived capabilities, scope, references and operation semantics.
  * Review implementations additionally enforce Human identity and presentation
  * ownership/applicability. ReviewCall retains verified session transport;
  * neither it nor an authenticated account proves physical human presence.
  */
trait OntologyService {
  def scopes(call: ServiceCall): IO[ScopesResult]
  def find(call: ServiceCall, request: FindRequest): IO[FindResult]
  def read(call: ServiceCall, request: ReadRequest): IO[ReadResult]
  def sources(call: ServiceCall, request: SourceRequest): IO[SourceResult]
  def status(call: ServiceCall, request: ScopeRequest): IO[CurationStatus]
  def present(call: ReviewCall, request: PresentRequest): IO[Presentation]
  def judge(call: ReviewCall, request: JudgmentRequest): IO[Judgment]
  def judgments(call: ServiceCall, request: ScopeRequest): IO[JudgmentsResult]
  def apply(call: ServiceCall, request: ApplyRequest): IO[ApplyResult]
  def ingest(call: ServiceCall, request: IngestRequest): IO[IngestResult]
  def capsule(call: ServiceCall, request: CapsuleRequest): IO[Capsule]
  def delivery(call: ServiceCall, request: DeliveryRequest): IO[DeliveryReceipt]
}
