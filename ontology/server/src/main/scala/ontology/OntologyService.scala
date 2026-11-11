package ontology

import cats.effect.IO
import ontology.api.*

/** Application boundary shared by REST and MCP. Implementations must recheck
  * credential-derived capabilities, scope, references and operation semantics.
  * Review implementations additionally enforce Human identity and presentation
  * ownership/applicability. Cookie-only review is a transport policy: Principal
  * neither carries session transport nor proves physical human presence.
  */
trait OntologyService {
  def scopes(principal: Principal): IO[ScopesResult]
  def find(principal: Principal, request: FindRequest): IO[FindResult]
  def read(principal: Principal, request: ReadRequest): IO[ReadResult]
  def sources(principal: Principal, request: SourceRequest): IO[SourceResult]
  def status(principal: Principal, request: ScopeRequest): IO[CurationStatus]
  def present(principal: Principal, request: PresentRequest): IO[Presentation]
  def judge(principal: Principal, request: JudgmentRequest): IO[Judgment]
  def judgments(principal: Principal, request: ScopeRequest): IO[JudgmentsResult]
  def apply(principal: Principal, request: ApplyRequest): IO[ApplyResult]
  def ingest(principal: Principal, request: IngestRequest): IO[IngestResult]
  def capsule(principal: Principal, request: CapsuleRequest): IO[Capsule]
  def delivery(principal: Principal, request: DeliveryRequest): IO[DeliveryReceipt]
}
