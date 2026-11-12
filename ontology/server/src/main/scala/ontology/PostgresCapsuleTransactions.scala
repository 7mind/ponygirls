package ontology

import cats.effect.IO
import java.sql.{Connection, PreparedStatement, ResultSet}
import java.time.Instant
import java.util.UUID
import scala.util.Using
import ontology.api.*
import ontology.domain.*
import ponygirls.runtime.JdbcDatabase

private[ontology] final class PostgresCapsuleTransactions(database: JdbcDatabase, lock: (Connection, String) => Unit,
  read: Connection => CurationReadContext, clock: Connection => Instant,
  evidence: (Connection, GraphSnapshot, List[AdoptionClaim]) => List[ReviewEvidence]) extends CapsuleTransactions {
  private def query[A](c: Connection, sql: String)(bind: PreparedStatement => Unit)(decode: ResultSet => A): A =
    Using.resource(c.prepareStatement(sql)) { p => bind(p); Using.resource(p.executeQuery())(decode) }
  private def insert(c: Connection, sql: String)(bind: PreparedStatement => Unit): Unit =
    Using.resource(c.prepareStatement(sql)) { p => bind(p); Require(p.executeUpdate() == 1, "database", "ledger insert did not create one row") }
  private def capsuleRow(row: ResultSet): CapsuleRow = {
    val value = StoredJson.decode(Capsule.codecJson, row.getString("payload"))
    val request = StoredJson.decode(CapsuleRequest.codecJson, row.getString("request_payload"))
    Require(value.id == row.getObject("capsule_id", classOf[UUID]) && value.payload.scope == row.getString("scope") &&
      value.owner.kind.toString == row.getString("owner_kind") && value.owner.id == row.getString("owner_id") &&
      value.requestId == row.getObject("request_id", classOf[UUID]) && value.payloadDigest == row.getString("payload_digest") &&
      value.payload.previousCapsuleId == Option(row.getObject("previous_capsule_id", classOf[UUID])), "corrupt", "capsule indexed columns differ")
    val result = CapsuleRow(request, row.getString("request_digest"), value)
    CapsuleRows.capsule(result)
    result
  }
  private def deliveryRow(row: ResultSet): DeliveryRow = {
    val value = StoredJson.decode(DeliveryReceipt.codecJson, row.getString("payload"))
    val request = StoredJson.decode(DeliveryRequest.codecJson, row.getString("request_payload"))
    Require(value.id == row.getObject("delivery_id", classOf[UUID]) && value.scope == row.getString("scope") &&
      value.owner.kind.toString == row.getString("owner_kind") && value.owner.id == row.getString("owner_id") &&
      value.requestId == row.getObject("request_id", classOf[UUID]) && value.capsuleId == row.getObject("capsule_id", classOf[UUID]),
      "corrupt", "delivery indexed columns differ")
    val result = DeliveryRow(request, row.getString("request_digest"), value)
    CapsuleRows.delivery(result)
    result
  }
  def run[A](scope: String)(body: CapsuleTransaction => A): IO[A] = database.transaction { c =>
    lock(c, scope)
    def sameScope(value: String): Unit = Require(value == scope, "invariant", "capsule transaction scope differs")
    body(new CapsuleTransaction {
      def now: Instant = clock(c)
      def curation: CurationReadContext = read(c)
      def capsule(s: String, id: UUID): Option[CapsuleRow] = {
        sameScope(s)
        query(c, "SELECT * FROM ontology_capsules WHERE scope = ? AND capsule_id = ?")(p => { p.setString(1, s); p.setObject(2, id) })(r => if (r.next()) Some(capsuleRow(r)) else None)
      }
      def capsuleRequest(s: String, owner: Actor, requestId: UUID): Option[CapsuleRow] = {
        sameScope(s)
        query(c, "SELECT * FROM ontology_capsules WHERE scope = ? AND owner_kind = ? AND owner_id = ? AND request_id = ?")(p => {
          p.setString(1, s); p.setString(2, owner.kind.toString); p.setString(3, owner.id); p.setObject(4, requestId)
        })(r => if (r.next()) Some(capsuleRow(r)) else None)
      }
      def delivery(s: String, id: UUID): Option[DeliveryRow] = {
        sameScope(s)
        query(c, "SELECT * FROM ontology_deliveries WHERE scope = ? AND delivery_id = ?")(p => { p.setString(1, s); p.setObject(2, id) })(r => if (r.next()) Some(deliveryRow(r)) else None)
      }
      def deliveryRequest(s: String, owner: Actor, requestId: UUID): Option[DeliveryRow] = {
        sameScope(s)
        query(c, "SELECT * FROM ontology_deliveries WHERE scope = ? AND owner_kind = ? AND owner_id = ? AND request_id = ?")(p => {
          p.setString(1, s); p.setString(2, owner.kind.toString); p.setString(3, owner.id); p.setObject(4, requestId)
        })(r => if (r.next()) Some(deliveryRow(r)) else None)
      }
      def insertCapsule(row: CapsuleRow): Unit = {
        val value = row.value
        sameScope(value.payload.scope); CapsuleRows.capsule(row)
        insert(c, "INSERT INTO ontology_capsules(scope, capsule_id, owner_kind, owner_id, request_id, request_digest, request_payload, previous_capsule_id, payload_digest, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)") { p =>
          p.setString(1, scope); p.setObject(2, value.id); p.setString(3, value.owner.kind.toString); p.setString(4, value.owner.id)
          p.setObject(5, value.requestId); p.setString(6, row.requestDigest); p.setString(7, StoredJson.encode(CapsuleRequest.codecJson, row.request))
          value.payload.previousCapsuleId match { case Some(id) => p.setObject(8, id); case None => p.setNull(8, java.sql.Types.OTHER) }
          p.setString(9, value.payloadDigest); p.setString(10, StoredJson.encode(Capsule.codecJson, value))
        }
      }
      def insertDelivery(row: DeliveryRow): Unit = {
        val value = row.value
        sameScope(value.scope); CapsuleRows.delivery(row)
        insert(c, "INSERT INTO ontology_deliveries(scope, delivery_id, owner_kind, owner_id, request_id, capsule_id, request_digest, request_payload, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)") { p =>
          p.setString(1, scope); p.setObject(2, value.id); p.setString(3, value.owner.kind.toString); p.setString(4, value.owner.id)
          p.setObject(5, value.requestId); p.setObject(6, value.capsuleId); p.setString(7, row.requestDigest)
          p.setString(8, StoredJson.encode(DeliveryRequest.codecJson, row.request)); p.setString(9, StoredJson.encode(DeliveryReceipt.codecJson, value))
        }
      }
      def reviewEvidence(graph: GraphSnapshot, claims: List[AdoptionClaim]): List[ReviewEvidence] = evidence(c, graph, claims)
    })
  }
}
