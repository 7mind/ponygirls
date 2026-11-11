package ontology

import cats.effect.IO
import java.sql.{Connection, PreparedStatement, ResultSet}
import java.time.Instant
import java.util.UUID
import scala.util.Using
import ontology.api.*
import ontology.domain.*
import ponygirls.runtime.JdbcDatabase

private[ontology] final class PostgresProjectionTransactions(database: JdbcDatabase, scopeLock: (Connection, String) => Unit,
  readHead: (Connection, String) => GraphSnapshot, readHistory: (Connection, String, Long) => GraphSnapshot,
  readCoordinator: Connection => CoordinatorState, clock: Connection => Instant) extends ProjectionTransactions {
  private def query[A](c: Connection, sql: String)(bind: PreparedStatement => Unit)(read: ResultSet => A): A =
    Using.resource(c.prepareStatement(sql)) { p => bind(p); Using.resource(p.executeQuery())(read) }
  private def update(c: Connection, sql: String)(bind: PreparedStatement => Unit): Unit =
    Using.resource(c.prepareStatement(sql)) { p => bind(p); Require(p.executeUpdate() == 1, "database", "projection write did not affect one row") }
  private def sessionRow(r: ResultSet): ProjectionSessionRow = {
    val s = StoredJson.decode(ProjectionSession.codecJson, r.getString("session_payload"))
    Require(s.id == r.getObject("session_id", classOf[UUID]) && s.instance.targetId == r.getString("target_id") &&
      s.instance.incarnation == r.getObject("incarnation", classOf[UUID]) && s.fence.ownerId == r.getObject("fence_owner", classOf[UUID]) &&
      s.fence.epoch == r.getLong("fence_epoch") && s.actor.id == r.getString("actor_id") && s.actor.kind.toString == r.getString("actor_kind"),
      "corrupt", "projection session indexed columns differ")
    ProjectionProtocol.session(s)
    ProjectionSessionRow(s, StoredJson.decode(ProjectionProgress.codecJson, r.getString("progress_payload")))
  }
  private def acknowledgmentRow(r: ResultSet): ProjectionAckReceipt = {
    val input = StoredJson.decode(ProjectionAckInput.codecJson, r.getString("request_payload"))
    val receipt = StoredJson.decode(ProjectionAckReceipt.codecJson, r.getString("receipt_payload"))
    Require(receipt.input == input && input.sessionId == r.getObject("session_id", classOf[UUID]) && input.requestId == r.getObject("request_id", classOf[UUID]) &&
      input.target.scope == r.getString("scope") && input.target.origin.toString == r.getString("target_origin") &&
      Digests.text(StoredJson.encode(ProjectionAckInput.codecJson, input)) == r.getString("request_digest"), "corrupt", "projection acknowledgment row differs")
    receipt
  }
  private def checkpointRow(r: ResultSet): ProjectionCheckpointWitness = {
    val value = StoredJson.decode(ProjectionCheckpointWitness.codecJson, r.getString("payload"))
    val point = value.checkpoint
    Require(point.instance.targetId == r.getString("target_id") && point.instance.incarnation == r.getObject("incarnation", classOf[UUID]) &&
      point.scope == r.getString("scope") && point.generation == r.getLong("generation") && point.digest == r.getString("digest") &&
      value.sessionId == r.getObject("witness_session", classOf[UUID]) && value.requestId == r.getObject("witness_request", classOf[UUID]),
      "corrupt", "projection checkpoint row differs")
    value
  }
  def run[A](body: ProjectionTransaction => A): IO[A] = database.transaction { c =>
    query(c, "SELECT singleton FROM ontology_curation_coordinator WHERE singleton FOR UPDATE")(_ => ())(r => Require(r.next(), "corrupt", "coordinator row missing"))
    body(new ProjectionTransaction {
      def now: Instant = clock(c)
      def coordinator: CoordinatorState = readCoordinator(c)
      def lock(scope: String): Unit = scopeLock(c, scope)
      def head(scope: String): GraphSnapshot = readHead(c, scope)
      def history(scope: String, generation: Long): GraphSnapshot = readHistory(c, scope, generation)
      def session(id: UUID): Option[ProjectionSessionRow] = query(c, "SELECT * FROM ontology_projection_sessions WHERE session_id = ?")(_.setObject(1, id))(r => if (r.next()) Some(sessionRow(r)) else None)
      def acquisition(instance: ProjectionInstance, fence: CoordinatorFence): Option[ProjectionSessionRow] = query(c,
        "SELECT * FROM ontology_projection_sessions WHERE target_id = ? AND incarnation = ? AND fence_epoch = ?")(p => {
          p.setString(1, instance.targetId); p.setObject(2, instance.incarnation); p.setLong(3, fence.epoch)
        })(r => if (r.next()) Some(sessionRow(r)) else None)
      def insertSession(row: ProjectionSessionRow): Unit = {
        val s = row.session
        update(c, "INSERT INTO ontology_projection_sessions(session_id, target_id, incarnation, fence_owner, fence_epoch, actor_id, actor_kind, session_payload, progress_payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)") { p =>
          p.setObject(1, s.id); p.setString(2, s.instance.targetId); p.setObject(3, s.instance.incarnation); p.setObject(4, s.fence.ownerId)
          p.setLong(5, s.fence.epoch); p.setString(6, s.actor.id); p.setString(7, s.actor.kind.toString)
          p.setString(8, StoredJson.encode(ProjectionSession.codecJson, s)); p.setString(9, StoredJson.encode(ProjectionProgress.codecJson, row.progress))
        }
      }
      def saveProgress(id: UUID, progress: ProjectionProgress): Unit = update(c, "UPDATE ontology_projection_sessions SET progress_payload = ? WHERE session_id = ?") { p =>
        p.setString(1, StoredJson.encode(ProjectionProgress.codecJson, progress)); p.setObject(2, id)
      }
      def acknowledgment(sessionId: UUID, requestId: UUID): Option[ProjectionAckReceipt] = query(c,
        "SELECT * FROM ontology_projection_acks WHERE session_id = ? AND request_id = ?")(p => { p.setObject(1, sessionId); p.setObject(2, requestId) })(r => if (r.next()) Some(acknowledgmentRow(r)) else None)
      def headAcknowledgments(sessionId: UUID): List[ProjectionAckReceipt] = query(c,
        "SELECT * FROM ontology_projection_acks WHERE session_id = ? AND target_origin = 'Head' ORDER BY scope")(_.setObject(1, sessionId)) { r =>
        val values = List.newBuilder[ProjectionAckReceipt]; while (r.next()) values += acknowledgmentRow(r); values.result()
      }
      def accepted(instance: ProjectionInstance, scope: String): List[ProjectionAckReceipt] = query(c,
        "SELECT a.* FROM ontology_projection_acks a JOIN ontology_projection_sessions s ON a.session_id = s.session_id WHERE s.target_id = ? AND s.incarnation = ? AND a.scope = ?")(p => {
          p.setString(1, instance.targetId); p.setObject(2, instance.incarnation); p.setString(3, scope)
        }) { r => val values = List.newBuilder[ProjectionAckReceipt]; while (r.next()) values += acknowledgmentRow(r); values.result() }
      def insertAcknowledgment(value: ProjectionAckReceipt): Unit = update(c,
        "INSERT INTO ontology_projection_acks(session_id, request_id, scope, target_origin, request_digest, request_payload, receipt_payload) VALUES (?, ?, ?, ?, ?, ?, ?)") { p =>
        val input = value.input; val content = StoredJson.encode(ProjectionAckInput.codecJson, input)
        p.setObject(1, input.sessionId); p.setObject(2, input.requestId); p.setString(3, input.target.scope); p.setString(4, input.target.origin.toString)
        p.setString(5, Digests.text(content)); p.setString(6, content); p.setString(7, StoredJson.encode(ProjectionAckReceipt.codecJson, value))
      }
      def checkpoint(instance: ProjectionInstance, scope: String): Option[ProjectionCheckpointWitness] = query(c,
        "SELECT * FROM ontology_projection_checkpoints WHERE target_id = ? AND incarnation = ? AND scope = ?")(p => {
          p.setString(1, instance.targetId); p.setObject(2, instance.incarnation); p.setString(3, scope)
        })(r => if (r.next()) Some(checkpointRow(r)) else None)
      def saveCheckpoint(value: ProjectionCheckpointWitness): Unit = update(c,
        "INSERT INTO ontology_projection_checkpoints(target_id, incarnation, scope, generation, digest, witness_session, witness_request, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (target_id, incarnation, scope) DO UPDATE SET generation = EXCLUDED.generation, digest = EXCLUDED.digest, witness_session = EXCLUDED.witness_session, witness_request = EXCLUDED.witness_request, payload = EXCLUDED.payload WHERE ontology_projection_checkpoints.generation <= EXCLUDED.generation") { p =>
        val point = value.checkpoint
        p.setString(1, point.instance.targetId); p.setObject(2, point.instance.incarnation); p.setString(3, point.scope); p.setLong(4, point.generation)
        p.setString(5, point.digest); p.setObject(6, value.sessionId); p.setObject(7, value.requestId); p.setString(8, StoredJson.encode(ProjectionCheckpointWitness.codecJson, value))
      }
      def outbox(scope: String, afterGeneration: Long, limit: Int): List[Long] = query(c,
        "SELECT generation FROM ontology_outbox WHERE scope = ? AND generation > ? ORDER BY generation LIMIT ?")(p => {
          p.setString(1, scope); p.setLong(2, afterGeneration); p.setInt(3, limit)
        }) { r => val values = List.newBuilder[Long]; while (r.next()) values += r.getLong(1); values.result() }
      def containsOutbox(scope: String, generation: Long): Boolean = query(c,
        "SELECT 1 FROM ontology_outbox WHERE scope = ? AND generation = ?")(p => { p.setString(1, scope); p.setLong(2, generation) })(_.next())
    })
  }
}
