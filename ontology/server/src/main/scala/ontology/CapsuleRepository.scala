package ontology

import cats.effect.IO
import java.time.Instant
import java.util.UUID
import ontology.api.*
import ontology.domain.*

final case class CapsuleStoreSettings(projection: CapsuleSettings, maxBaselineChain: Int, maxMaterialSnapshots: Int) {
  Require(maxBaselineChain > 0 && maxMaterialSnapshots > 0, "config", "positive capsule ancestry and material-cut bounds required")
}

trait CapsuleRepository {
  def prepare(request: CapsuleRequest, call: ServiceCall, hostId: UUID): IO[Capsule]
  def capsule(principal: Principal, scope: String, id: UUID): IO[Capsule]
  def recordDelivery(request: DeliveryRequest, call: ServiceCall, hostId: UUID): IO[DeliveryReceipt]
  def delivery(principal: Principal, scope: String, id: UUID): IO[DeliveryReceipt]
}

private[ontology] final case class CapsuleRow(request: CapsuleRequest, requestDigest: String, value: Capsule)
private[ontology] final case class DeliveryRow(request: DeliveryRequest, requestDigest: String, value: DeliveryReceipt)
private[ontology] trait CapsuleTransactions {
  def run[A](scope: String)(body: CapsuleTransaction => A): IO[A]
}
private[ontology] trait CapsuleTransaction {
  def now: Instant
  def curation: CurationReadContext
  def capsule(scope: String, id: UUID): Option[CapsuleRow]
  def capsuleRequest(scope: String, owner: Actor, requestId: UUID): Option[CapsuleRow]
  def delivery(scope: String, id: UUID): Option[DeliveryRow]
  def deliveryRequest(scope: String, owner: Actor, requestId: UUID): Option[DeliveryRow]
  def insertCapsule(row: CapsuleRow): Unit
  def insertDelivery(row: DeliveryRow): Unit
  def reviewEvidence(graph: GraphSnapshot, claims: List[AdoptionClaim]): List[ReviewEvidence]
}
