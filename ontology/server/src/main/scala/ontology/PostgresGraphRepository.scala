package ontology

import cats.effect.IO
import ontology.api.*
import ontology.domain.*
import ponygirls.runtime.{JdbcDatabase, Migration}
import java.sql.{Connection, PreparedStatement, ResultSet}
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID
import scala.util.Using

final class PostgresGraphRepository(database: JdbcDatabase, engine: AdmissionEngine) extends GraphRepository {
  private val capture = new CaptureEngine
  def initialize: IO[Unit] = IO.blocking {
    val stream = Option(getClass.getResourceAsStream("/001_graph.sql")).getOrElse(throw Fault("config", "graph migration resource missing"))
    Using.resource(stream)(s => new String(s.readAllBytes(), UTF_8))
  }.flatMap(sql => database.migrate("ontology", List(Migration(1, "graph", sql))))
  private def query[A](c: Connection, sql: String)(bind: PreparedStatement => Unit)(read: ResultSet => A): A =
    Using.resource(c.prepareStatement(sql)) { p => bind(p); Using.resource(p.executeQuery())(read) }
  private def update(c: Connection, sql: String)(bind: PreparedStatement => Unit): Int =
    Using.resource(c.prepareStatement(sql)) { p => bind(p); p.executeUpdate() }
  private def decodeSnapshot(scope: String, generation: Long, text: String): GraphSnapshot = {
    val snapshot = StoredJson.decode(GraphSnapshot.codecJson, text)
    Require(snapshot.scope == scope && snapshot.generation == generation, "corrupt", "snapshot does not match its row identity")
    snapshot
  }
  private def load(c: Connection, scope: String): GraphSnapshot = query(c, "SELECT generation, snapshot FROM ontology_scopes WHERE scope = ?")(_.setString(1, scope)) { r =>
    if (r.next()) decodeSnapshot(scope, r.getLong(1), r.getString(2)) else Graph.empty(scope)
  }
  private def lock(c: Connection, scope: String): Unit = query(c, "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))")(_.setString(1, "ontology:" + scope))(r => { Require(r.next(), "database", "scope lock result unavailable"); () })
  private def saveGraph(c: Connection, before: GraphSnapshot, after: GraphSnapshot): Unit = {
    Require(before.scope == after.scope && after.generation == Math.addExact(before.generation, 1L), "invariant", "invalid graph publication")
    val json = StoredJson.encode(GraphSnapshot.codecJson, after)
    update(c, "INSERT INTO ontology_scopes(scope, generation, snapshot) VALUES (?, ?, ?) ON CONFLICT (scope) DO UPDATE SET generation = EXCLUDED.generation, snapshot = EXCLUDED.snapshot")(p => { p.setString(1, after.scope); p.setLong(2, after.generation); p.setString(3, json) })
    update(c, "INSERT INTO ontology_revisions(scope, generation, snapshot) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")(p => { p.setString(1, before.scope); p.setLong(2, before.generation); p.setString(3, StoredJson.encode(GraphSnapshot.codecJson, before)) })
    update(c, "INSERT INTO ontology_revisions(scope, generation, snapshot) VALUES (?, ?, ?)")(p => { p.setString(1, after.scope); p.setLong(2, after.generation); p.setString(3, json) })
    update(c, "INSERT INTO ontology_outbox(scope, generation) VALUES (?, ?)")(p => { p.setString(1, after.scope); p.setLong(2, after.generation) })
  }
  private def saveInput(c: Connection, receipt: InputReceipt): Unit = {
    update(c, "INSERT INTO ontology_inputs(scope, input_id, generation, payload) VALUES (?, ?, ?, ?)")(p => { p.setString(1, receipt.scope); p.setObject(2, receipt.ref.id); p.setLong(3, receipt.generation); p.setString(4, StoredJson.encode(InputReceipt.codecJson, receipt)) })
  }
  def read(scope: String): IO[GraphSnapshot] = database.transaction(c => load(c, scope))
  def history(scope: String, generation: Long): IO[GraphSnapshot] = database.transaction { c =>
    query(c, "SELECT snapshot FROM ontology_revisions WHERE scope = ? AND generation = ?")(p => { p.setString(1, scope); p.setLong(2, generation) }) { r =>
      Require(r.next(), "not-found", "graph revision not found"); decodeSnapshot(scope, generation, r.getString(1))
    }
  }
  def scopes: IO[List[String]] = database.transaction { c => query(c, "SELECT scope FROM ontology_scopes ORDER BY scope")(_ => ()) { r =>
    val items = List.newBuilder[String]; while (r.next()) items += r.getString(1); items.result()
  } }
  def input(scope: String, ref: Ref): IO[InputReceipt] = database.transaction { c =>
    Require(ref.revision == 1, "not-found", "input receipts are immutable")
    query(c, "SELECT generation, payload FROM ontology_inputs WHERE scope = ? AND input_id = ?")(p => { p.setString(1, scope); p.setObject(2, ref.id) }) { r =>
      Require(r.next(), "not-found", "input receipt not found")
      val receipt = StoredJson.decode(InputReceipt.codecJson, r.getString(2))
      Require(receipt.scope == scope && receipt.ref == ref && receipt.generation == r.getLong(1) && receipt.digest == Digests.text(receipt.content), "corrupt", "input receipt binding mismatch")
      receipt
    }
  }
  def apply(request: ApplyRequest, admission: Admission): IO[ApplyResult] = database.transaction { c =>
    Require(request.requestId == admission.requestId, "request", "request binding mismatch")
    lock(c, request.scope)
    val content = StoredJson.encode(ApplyRequest.codecJson, request)
    val digest = Digests.text(content)
    val previous = query(c, "SELECT payload_digest, result FROM ontology_mutations WHERE scope = ? AND actor_id = ? AND actor_kind = ? AND request_id = ?")(p => {
      p.setString(1, request.scope); p.setString(2, admission.actor.id); p.setString(3, admission.actor.kind.toString); p.setObject(4, request.requestId)
    })(r => if (r.next()) Some((r.getString(1), r.getString(2))) else None)
    previous match {
      case Some((storedDigest, result)) =>
        Require(digest == storedDigest, "replay-conflict", "request ID has different content")
        val stored = StoredJson.decode(ApplyResult.codecJson, result)
        Require(stored.scope == request.scope && stored.requestId == request.requestId, "corrupt", "mutation result binding mismatch")
        stored.copy(replayed = true)
      case None =>
        val before = load(c, request.scope)
        val changed = engine(before, request, admission)
        saveGraph(c, before, changed.snapshot)
        saveInput(c, InputReceipts.create(admission.provenance.input, request.scope, changed.snapshot.generation, InputKind.GraphMutation, admission.actor, admission.recorder, admission.actor, "ontology.api.ApplyRequest/0.1.0 canonical JSON", content, admission.recordedAt))
        update(c, "INSERT INTO ontology_mutations(scope, actor_id, actor_kind, request_id, payload_digest, result) VALUES (?, ?, ?, ?, ?, ?)")(p => {
          p.setString(1, request.scope); p.setString(2, admission.actor.id); p.setString(3, admission.actor.kind.toString); p.setObject(4, request.requestId); p.setString(5, digest); p.setString(6, StoredJson.encode(ApplyResult.codecJson, changed.result))
        })
        changed.result
    }
  }
  private def frontier(c: Connection, scope: String): Long = query(c, "SELECT frontier FROM ontology_scopes WHERE scope = ?")(_.setString(1, scope))(r => if (r.next()) r.getLong(1) else 0L)
  private def eventRow(scope: String, r: ResultSet): (CapturedEvent, IngestResult, String) = {
    val namespace = r.getString("source_namespace")
    val eventId = r.getObject("event_id", classOf[UUID])
    val event = StoredJson.decode(CapturedEvent.codecJson, r.getString("payload"))
    Require(event.scope == scope && event.sourceNamespace == namespace && event.id == CaptureIdentity.event(namespace, eventId) && event.frontier == r.getLong("frontier"), "corrupt", "capture row identity mismatch")
    Require(CaptureIdentity.fingerprint(event, eventId) == r.getString("fingerprint"), "corrupt", "capture content binding mismatch")
    val result = StoredJson.decode(IngestResult.codecJson, r.getString("result"))
    validateResult(event, result, eventId)
    Require(InputReceipts.id(InputKind.Capture, namespace, result.requestId) == event.provenance.input, "corrupt", "capture input receipt mismatch")
    (event, result, r.getString("fingerprint"))
  }
  private def validateResult(event: CapturedEvent, result: IngestResult, eventId: UUID): Unit = Require(result.scope == event.scope && result.eventId == eventId && result.sourceNamespace == event.sourceNamespace && result.source == Ref(event.id, 1) && result.frontier == event.frontier && result.artifacts == CaptureIdentity.artifacts(event), "corrupt", "capture result binding mismatch")
  private def existingEvent(c: Connection, request: IngestRequest, namespace: String): Option[(CapturedEvent, IngestResult, String)] = query(c, "SELECT * FROM ontology_captures WHERE scope = ? AND source_namespace = ? AND event_id = ?")(p => { p.setString(1, request.scope); p.setString(2, namespace); p.setObject(3, request.eventId) })(r => if (r.next()) Some(eventRow(request.scope, r)) else None)
  def ingest(request: IngestRequest, principal: Principal, recorder: Actor, receivedAt: String): IO[IngestResult] = database.transaction { c =>
    capture.validateIngress(request, principal)
    lock(c, request.scope)
    val namespace = principal.credentialId
    val digest = Digests.text(StoredJson.encode(IngestRequest.codecJson, request))
    val priorRequest = query(c, "SELECT payload_digest, result FROM ontology_ingest_requests WHERE scope = ? AND source_namespace = ? AND request_id = ?")(p => { p.setString(1, request.scope); p.setString(2, namespace); p.setObject(3, request.requestId) })(r => if (r.next()) Some((r.getString(1), r.getString(2))) else None)
    priorRequest match {
      case Some((previous, stored)) =>
        Require(previous == digest, "replay-conflict", "request ID has different content")
        val (event, _, fingerprint) = existingEvent(c, request, namespace).getOrElse(throw Fault("corrupt", "ingest receipt has no captured event"))
        Require(fingerprint == CaptureIdentity.fingerprint(namespace, request), "corrupt", "ingest receipt event mismatch")
        val result = StoredJson.decode(IngestResult.codecJson, stored)
        validateResult(event, result, request.eventId)
        Require(result.requestId == request.requestId, "corrupt", "ingest request binding mismatch")
        result.copy(replayed = true)
      case None =>
        val fingerprint = CaptureIdentity.fingerprint(namespace, request)
        val result = existingEvent(c, request, namespace) match {
          case Some((_, stored, previous)) => Require(previous == fingerprint, "replay-conflict", "source event ID has different content"); stored.copy(requestId = request.requestId, replayed = true)
          case None =>
            val before = load(c, request.scope)
            val observed = frontier(c, request.scope)
            val prior = query(c, "SELECT * FROM ontology_captures WHERE scope = ? AND source_namespace = ? ORDER BY frontier")(p => { p.setString(1, request.scope); p.setString(2, namespace) }) { r => val rows = List.newBuilder[CapturedEvent]; while (r.next()) rows += eventRow(request.scope, r)._1; rows.result() }
            val changed = capture(before, prior, observed, request, principal, recorder, receivedAt)
            saveGraph(c, before, changed.snapshot)
            saveInput(c, changed.receipt)
            update(c, "INSERT INTO ontology_captures(scope, source_namespace, event_id, capture_id, frontier, fingerprint, payload, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")(p => { p.setString(1, request.scope); p.setString(2, namespace); p.setObject(3, request.eventId); p.setObject(4, changed.event.id); p.setLong(5, changed.event.frontier); p.setString(6, fingerprint); p.setString(7, StoredJson.encode(CapturedEvent.codecJson, changed.event)); p.setString(8, StoredJson.encode(IngestResult.codecJson, changed.result)) })
            update(c, "UPDATE ontology_scopes SET frontier = ? WHERE scope = ?")(p => { p.setLong(1, changed.event.frontier); p.setString(2, request.scope) })
            changed.result
        }
        update(c, "INSERT INTO ontology_ingest_requests(scope, source_namespace, request_id, payload_digest, result) VALUES (?, ?, ?, ?, ?)")(p => { p.setString(1, request.scope); p.setString(2, namespace); p.setObject(3, request.requestId); p.setString(4, digest); p.setString(5, StoredJson.encode(IngestResult.codecJson, result)) })
        result
    }
  }
  def sources(request: SourceRequest): IO[SourceResult] = database.transaction { c =>
    val current = frontier(c, request.scope)
    Require(request.after >= 0 && request.after <= current && request.limit > 0 && request.limit < Int.MaxValue, "source-page", "invalid source page")
    val events = query(c, "SELECT * FROM ontology_captures WHERE scope = ? AND frontier > ? AND frontier <= ? ORDER BY frontier LIMIT ?")(p => { p.setString(1, request.scope); p.setLong(2, request.after); p.setLong(3, current); p.setInt(4, request.limit + 1) }) { r => val rows = List.newBuilder[CapturedEvent]; while (r.next()) rows += eventRow(request.scope, r)._1; rows.result() }
    val page = events.take(request.limit)
    SourceResult(request.scope, page, current, if (events.size > page.size) Some(page.last.frontier) else None)
  }
  def pendingProjections(limit: Int): IO[List[GraphSnapshot]] = database.transaction { c =>
    Require(limit > 0, "limit", "positive projection batch required")
    query(c, "SELECT r.scope, r.generation, r.snapshot FROM ontology_outbox o JOIN ontology_revisions r USING(scope, generation) WHERE NOT o.published ORDER BY o.scope, o.generation LIMIT ?")(_.setInt(1, limit)) { r =>
      val rows = List.newBuilder[GraphSnapshot]; while (r.next()) rows += decodeSnapshot(r.getString(1), r.getLong(2), r.getString(3)); rows.result()
    }
  }
  def acknowledgeProjection(scope: String, generation: Long): IO[Unit] = database.transaction { c =>
    val affected = update(c, "UPDATE ontology_outbox SET published = true WHERE scope = ? AND generation = ?")(p => { p.setString(1, scope); p.setLong(2, generation) })
    Require(affected == 1, "not-found", "unknown projected revision")
  }
}
