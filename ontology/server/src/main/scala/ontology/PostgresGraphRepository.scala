package ontology

import cats.effect.IO
import ontology.api.*
import ontology.domain.*
import ponygirls.runtime.{JdbcDatabase, Migration}
import java.sql.{Connection, PreparedStatement, ResultSet}
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID
import scala.util.Using

final class PostgresGraphRepository(database: JdbcDatabase, engine: AdmissionEngine, review: ReviewDomain, curationSettings: CurationStoreSettings) extends GraphRepository {
  private val capture = new CaptureEngine
  private val commands = new GraphCommandEngine(engine)
  private val curationValidation = new CurationValidation(engine)
  private val curationStore = new CurationStore(curationTransactions, curationReadTransactions, curationSettings, engine)
  val curation: CurationRepository = curationStore
  def projections(settings: ProjectionSettings): ProjectionRepository = {
    val transactions = new PostgresProjectionTransactions(database, lock, (c, scope) => verified(c, load(c, scope)), loadHistory,
      c => curationTransaction(c).coordinator, c => curationTransaction(c).now)
    new ProjectionStore(transactions, settings)
  }
  def capsules(settings: CapsuleStoreSettings): CapsuleRepository = {
    val transactions = new PostgresCapsuleTransactions(database, lock, curationRead, c => curationTransaction(c).now, loadAdoptions)
    new CapsuleStore(transactions, settings, new CurationReadModel(curationValidation), curationValidation)
  }
  def initialize: IO[Unit] = IO.blocking {
    def sql(file: String): String = {
      val stream = Option(getClass.getResourceAsStream("/" + file)).getOrElse(throw Fault("config", "migration resource missing"))
      Using.resource(stream)(s => new String(s.readAllBytes(), UTF_8))
    }
    List(Migration(1, "graph", sql("001_graph.sql")), Migration(2, "review", sql("002_review.sql")), Migration(3, "curation", sql("003_curation.sql")), Migration(4, "graph-commands", sql("004_graph_commands.sql")), Migration(5, "capsules", sql("005_capsules.sql")), Migration(6, "projection-sessions", sql("006_projection_sessions.sql")))
  }.flatMap(migrations => database.migrate("ontology", migrations))
  private def query[A](c: Connection, sql: String)(bind: PreparedStatement => Unit)(read: ResultSet => A): A =
    Using.resource(c.prepareStatement(sql)) { p => bind(p); Using.resource(p.executeQuery())(read) }
  private def update(c: Connection, sql: String)(bind: PreparedStatement => Unit): Int =
    Using.resource(c.prepareStatement(sql)) { p => bind(p); p.executeUpdate() }
  private def decodeSnapshot(scope: String, generation: Long, text: String): GraphSnapshot = {
    val snapshot = StoredJson.decode(GraphSnapshot.codecJson, text)
    Require(snapshot.scope == scope && snapshot.generation == generation, "corrupt", "snapshot does not match its row identity")
    Graph.validateCounters(snapshot)
    snapshot
  }
  private def load(c: Connection, scope: String): GraphSnapshot = query(c, "SELECT generation, snapshot, frontier FROM ontology_scopes WHERE scope = ?")(_.setString(1, scope)) { r =>
    if (r.next()) {
      val snapshot = decodeSnapshot(scope, r.getLong(1), r.getString(2))
      Require(snapshot.sourceFrontier == r.getLong(3), "corrupt", "snapshot source frontier differs from scope head")
      snapshot
    } else Graph.empty(scope)
  }
  private def lock(c: Connection, scope: String): Unit = query(c, "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))")(_.setString(1, "ontology:" + scope))(r => { Require(r.next(), "database", "scope lock result unavailable"); () })
  private def saveGraph(c: Connection, before: GraphSnapshot, after: GraphSnapshot): Unit = {
    Require(before.scope == after.scope && after.generation == Math.addExact(before.generation, 1L), "invariant", "invalid graph publication")
    Graph.validateCounters(after)
    val json = StoredJson.encode(GraphSnapshot.codecJson, after)
    update(c, "INSERT INTO ontology_scopes(scope, generation, snapshot, frontier) VALUES (?, ?, ?, ?) ON CONFLICT (scope) DO UPDATE SET generation = EXCLUDED.generation, snapshot = EXCLUDED.snapshot, frontier = EXCLUDED.frontier")(p => { p.setString(1, after.scope); p.setLong(2, after.generation); p.setString(3, json); p.setLong(4, after.sourceFrontier) })
    update(c, "INSERT INTO ontology_revisions(scope, generation, snapshot) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")(p => { p.setString(1, before.scope); p.setLong(2, before.generation); p.setString(3, StoredJson.encode(GraphSnapshot.codecJson, before)) })
    update(c, "INSERT INTO ontology_revisions(scope, generation, snapshot) VALUES (?, ?, ?)")(p => { p.setString(1, after.scope); p.setLong(2, after.generation); p.setString(3, json) })
    update(c, "INSERT INTO ontology_outbox(scope, generation) VALUES (?, ?)")(p => { p.setString(1, after.scope); p.setLong(2, after.generation) })
  }
  private def saveInput(c: Connection, receipt: InputReceipt): Unit = {
    update(c, "INSERT INTO ontology_inputs(scope, input_id, generation, payload) VALUES (?, ?, ?, ?)")(p => { p.setString(1, receipt.scope); p.setObject(2, receipt.ref.id); p.setLong(3, receipt.generation); p.setString(4, StoredJson.encode(InputReceipt.codecJson, receipt)) })
  }
  private def verified(c: Connection, graph: GraphSnapshot): GraphSnapshot = curationValidation.graph(curationRead(c), verifiedPrimary(c, graph))
  private def verifiedPrimary(c: Connection, graph: GraphSnapshot): GraphSnapshot = {
    val events = query(c, "SELECT * FROM ontology_captures WHERE scope = ? AND frontier <= ? ORDER BY frontier")(p => { p.setString(1, graph.scope); p.setLong(2, graph.sourceFrontier) }) { rows =>
      val values = List.newBuilder[PrimaryRecord]
      while (rows.next()) values += eventRow(c, graph, rows)
      values.result()
    }
    SourceIntegrity.frontier(graph, events.map(_.event))
    PrimaryIntegrity.inventory(graph, events)
    graph
  }
  def read(scope: String): IO[GraphSnapshot] = database.transaction(c => verified(c, load(c, scope)))
  private def loadHistory(c: Connection, scope: String, generation: Long): GraphSnapshot = verified(c, loadHistoryPrimary(c, scope, generation))
  private def loadHistoryPrimary(c: Connection, scope: String, generation: Long): GraphSnapshot = verifiedPrimary(c, loadHistoryRaw(c, scope, generation))
  private def loadHistoryRaw(c: Connection, scope: String, generation: Long): GraphSnapshot =
    query(c, "SELECT snapshot FROM ontology_revisions WHERE scope = ? AND generation = ?")(p => { p.setString(1, scope); p.setLong(2, generation) }) { r =>
      Require(r.next(), "not-found", "graph revision not found"); decodeSnapshot(scope, generation, r.getString(1))
    }
  def history(scope: String, generation: Long): IO[GraphSnapshot] = database.transaction(c => loadHistory(c, scope, generation))
  private def validateContexts(c: Connection, principal: Principal, contexts: List[ContextRecord]): Unit = {
    val keys = ContextAccess.requiredSnapshots(principal, contexts)
    val snapshots = keys.map(key => loadHistory(c, key.scope, key.generation))
    ContextAccess.validate(contexts, snapshots)
  }
  def scopes: IO[List[String]] = database.transaction { c => query(c, "SELECT scope FROM ontology_scopes ORDER BY scope")(_ => ()) { r =>
    val items = List.newBuilder[String]; while (r.next()) items += r.getString(1); items.result()
  } }
  def input(scope: String, ref: Ref): IO[InputReceipt] = database.transaction { c =>
    val receipt = loadInput(c, scope, ref)
    if (Set(InputKind.Capture, InputKind.Judgment, InputKind.PresentationPublication, InputKind.GraphMutation).contains(receipt.kind)) {
      val graph = verified(c, load(c, scope))
      if (receipt.kind == InputKind.GraphMutation) commandLink(c, graph, receipt)
      else SourceIntegrity.linkedInput(graph, receipt)
    }
    receipt
  }.flatMap(receipt => if (receipt.kind == InputKind.Curation) curationStore.validateInput(receipt).map(_ => receipt) else IO.pure(receipt))
  private def loadInput(c: Connection, scope: String, ref: Ref): InputReceipt = {
    Require(ref.revision == 1, "not-found", "input receipts are immutable")
    query(c, "SELECT generation, payload FROM ontology_inputs WHERE scope = ? AND input_id = ?")(p => { p.setString(1, scope); p.setObject(2, ref.id) }) { r =>
      Require(r.next(), "not-found", "input receipt not found")
      val receipt = StoredJson.decode(InputReceipt.codecJson, r.getString(2))
      Require(receipt.scope == scope && receipt.ref == ref && receipt.generation == r.getLong(1) && receipt.digest == Digests.text(receipt.content), "corrupt", "input receipt binding mismatch")
      InputReceipts.validateContext(receipt)
      receipt
    }
  }
  def apply(request: ApplyRequest, admission: Admission): IO[ApplyResult] = database.transaction { c =>
    Require(request.requestId == admission.requestId, "request", "request binding mismatch")
    admission.principal.require(request.scope, Capability.Mutate)
    val context = Contexts.contribution(request.contributionContext, admission.ingress, Contexts.ProtocolLimits)
    Contexts.server(admission.ingress, Contexts.ProtocolLimits)
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
        val graph = verified(c, load(c, request.scope))
        val receipt = loadInput(c, request.scope, Ref(InputReceipts.graphId(admission.actor, request.requestId), 1))
        Require(receipt.digest == storedDigest, "corrupt", "replayed command receipt differs")
        commandLink(c, graph, receipt)
        stored.copy(replayed = true)
      case None =>
        val claims = Adoptions.claims(request)
        if (claims.nonEmpty) admission.principal.require(request.scope, Capability.Read)
        validateContexts(c, admission.principal, List(context))
        val before = verified(c, load(c, request.scope))
        val changed = commands(before, request, admission.copy(reviewEvidence = loadAdoptions(c, before, claims)))
        saveGraph(c, before, changed.snapshot)
        saveInput(c, changed.receipt)
        savePrimary(c, PrimaryRecord(request.requestId, changed.event, CaptureIdentity.fingerprint(changed.event, request.requestId), PrimaryOutcome.Commanded(changed.result)))
        update(c, "INSERT INTO ontology_mutations(scope, actor_id, actor_kind, request_id, payload_digest, result) VALUES (?, ?, ?, ?, ?, ?)")(p => {
          p.setString(1, request.scope); p.setString(2, admission.actor.id); p.setString(3, admission.actor.kind.toString); p.setObject(4, request.requestId); p.setString(5, digest); p.setString(6, StoredJson.encode(ApplyResult.codecJson, changed.result))
        })
        verified(c, changed.snapshot)
        changed.result
    }
  }
  private def commandLink(c: Connection, graph: GraphSnapshot, receipt: InputReceipt): Unit = {
    val request = StoredJson.decode(ApplyRequest.codecJson, receipt.content)
    val source = GraphCommandIdentity.source(graph.scope, receipt.contributor, request.requestId)
    query(c, "SELECT * FROM ontology_captures WHERE scope = ? AND capture_id = ?")(p => { p.setString(1, graph.scope); p.setObject(2, source.id) }) { row =>
      Require(row.next(), "corrupt", "mutation receipt has no command primary")
      val record = eventRow(c, graph, row)
      Require(record.kind == InputKind.GraphMutation && record.event.provenance.input == receipt.ref.id,
        "corrupt", "mutation receipt command linkage differs")
    }
    SourceIntegrity.linkedInput(graph, receipt)
  }
  private def loadPresentation(c: Connection, scope: String, id: UUID): Presentation =
    query(c, "SELECT * FROM ontology_presentations WHERE scope = ? AND presentation_id = ?")(s => { s.setString(1, scope); s.setObject(2, id) }) { row =>
      Require(row.next(), "not-found", "presentation not found")
      val value = StoredJson.decode(Presentation.codecJson, row.getString("payload"))
      Require(value.id == id && value.payload.scope == scope && value.owner.id == row.getString("owner_id") &&
        value.owner.kind.toString == row.getString("owner_kind") && value.payload.generation == row.getLong("generation") &&
        value.reservedSourceRef.id == row.getObject("reserved_source_id", classOf[UUID]) && value.payloadDigest == row.getString("payload_digest"),
        "corrupt", "presentation row binding mismatch")
      try review.validatePresentation(value) catch { case _: Fault => throw Fault("corrupt", "invalid retained presentation") }
      value
    }
  private def optionalInput(c: Connection, scope: String, ref: Ref): Option[InputReceipt] = {
    val exists = query(c, "SELECT 1 FROM ontology_inputs WHERE scope = ? AND input_id = ?")(s => { s.setString(1, scope); s.setObject(2, ref.id) })(_.next())
    if (exists) Some(loadInput(c, scope, ref)) else None
  }
  private def savePrimary(c: Connection, record: PrimaryRecord): Unit = {
    val result = record.outcome match {
      case PrimaryOutcome.Captured(value) => StoredJson.encode(IngestResult.codecJson, value)
      case PrimaryOutcome.Reviewed(value) => StoredJson.encode(Judgment.codecJson, value)
      case PrimaryOutcome.Commanded(value) => StoredJson.encode(ApplyResult.codecJson, value)
    }
    val event = record.event
    update(c, "INSERT INTO ontology_captures(scope, source_namespace, event_id, capture_id, frontier, fingerprint, payload, result, input_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")(s => {
      s.setString(1, event.scope); s.setString(2, event.sourceNamespace); s.setObject(3, record.eventId); s.setObject(4, event.id)
      s.setLong(5, event.frontier); s.setString(6, record.fingerprint); s.setString(7, StoredJson.encode(CapturedEvent.codecJson, event))
      s.setString(8, result); s.setString(9, record.kind.toString)
    })
  }
  private def loadJudgment(c: Connection, graph: GraphSnapshot, captureId: UUID): Judgment =
    query(c, "SELECT * FROM ontology_captures WHERE scope = ? AND capture_id = ?")(s => { s.setString(1, graph.scope); s.setObject(2, captureId) }) { row =>
      Require(row.next(), "corrupt", "judgment primary row missing")
      eventRow(c, graph, row).outcome match {
        case PrimaryOutcome.Reviewed(value) => value
        case _ => throw Fault("corrupt", "judgment index points to a generic capture")
      }
    }
  private def reviewEvidence(c: Connection, graph: GraphSnapshot, record: PrimaryRecord): ReviewEvidence = record.outcome match {
    case PrimaryOutcome.Reviewed(value) =>
      val p = loadPresentation(c, graph.scope, value.presentationId)
      ReviewEvidence(p, value, record.event, loadInput(c, graph.scope, Ref(record.event.provenance.input, 1)), loadInput(c, graph.scope, review.publicationInput(p)))
    case _ => throw Fault("presentation", "linked review response required")
  }
  private def loadAdoptions(c: Connection, graph: GraphSnapshot, claims: List[AdoptionClaim]): List[ReviewEvidence] = claims.map { claim =>
    Require(claim.response.revision == 1, "presentation", "review response is immutable")
    query(c, "SELECT * FROM ontology_captures WHERE scope = ? AND capture_id = ? AND input_kind = 'Judgment'")(s => { s.setString(1, graph.scope); s.setObject(2, claim.response.id) }) { row =>
      Require(row.next(), "presentation", "review response not found")
      val record = eventRow(c, graph, row)
      Require(record.event.reviewResponse.exists(_.presentationId == claim.presentationId), "presentation", "presentation response pair mismatch")
      reviewEvidence(c, graph, record)
    }
  }
  private def eventRow(c: Connection, graph: GraphSnapshot, r: ResultSet): PrimaryRecord = {
    val event = StoredJson.decode(CapturedEvent.codecJson, r.getString("payload"))
    Require(event.scope == graph.scope && event.sourceNamespace == r.getString("source_namespace") &&
      event.id == r.getObject("capture_id", classOf[UUID]) && event.frontier == r.getLong("frontier"), "corrupt", "primary row identity mismatch")
    val outcome = r.getString("input_kind") match {
      case "Capture" => PrimaryOutcome.Captured(StoredJson.decode(IngestResult.codecJson, r.getString("result")))
      case "Judgment" => PrimaryOutcome.Reviewed(StoredJson.decode(Judgment.codecJson, r.getString("result")))
      case "GraphMutation" => PrimaryOutcome.Commanded(StoredJson.decode(ApplyResult.codecJson, r.getString("result")))
      case _ => throw Fault("corrupt", "invalid primary input kind")
    }
    val record = PrimaryRecord(r.getObject("event_id", classOf[UUID]), event, r.getString("fingerprint"), outcome)
    val receipt = loadInput(c, graph.scope, Ref(event.provenance.input, 1))
    outcome match {
      case _: PrimaryOutcome.Captured =>
        val indexed = query(c, "SELECT 1 FROM ontology_judgments WHERE scope = ? AND capture_id = ?")(s => { s.setString(1, graph.scope); s.setObject(2, event.id) })(_.next())
        PrimaryIntegrity.capture(graph, record, receipt, indexed)
      case PrimaryOutcome.Commanded(value) =>
        val indexed = query(c, "SELECT 1 FROM ontology_judgments WHERE scope = ? AND capture_id = ?")(s => { s.setString(1, graph.scope); s.setObject(2, event.id) })(_.next())
        val request = StoredJson.decode(ApplyRequest.codecJson, receipt.content)
        val before = loadHistoryRaw(c, graph.scope, request.expectedGeneration)
        PrimaryIntegrity.command(graph, record, receipt, indexed, before, loadAdoptions(c, before, Adoptions.claims(request)), engine)
        query(c, "SELECT payload_digest, result FROM ontology_mutations WHERE scope = ? AND actor_id = ? AND actor_kind = ? AND request_id = ?")(s => {
          s.setString(1, graph.scope); s.setString(2, receipt.contributor.id); s.setString(3, receipt.contributor.kind.toString); s.setObject(4, value.requestId)
        }) { index =>
          Require(index.next() && index.getString(1) == receipt.digest && StoredJson.decode(ApplyResult.codecJson, index.getString(2)) == value,
            "corrupt", "command mutation index missing or different")
        }
      case PrimaryOutcome.Reviewed(value) =>
        val evidence = reviewEvidence(c, graph, record)
        val p = evidence.presentation
        PrimaryIntegrity.judgment(graph, record, evidence, review)
        query(c, "SELECT actor_id, actor_kind, request_id, judgment_id, presentation_id, payload_digest FROM ontology_judgments WHERE scope = ? AND capture_id = ?")(s => { s.setString(1, graph.scope); s.setObject(2, event.id) }) { index =>
          Require(index.next() && index.getString(1) == value.actor.id && index.getString(2) == value.actor.kind.toString &&
            index.getObject(3, classOf[UUID]) == value.requestId && index.getObject(4, classOf[UUID]) == value.id &&
            index.getObject(5, classOf[UUID]) == p.id && index.getString(6) == receipt.digest, "corrupt", "judgment index mismatch")
        }
    }
    record
  }
  private def validateResult(event: CapturedEvent, result: IngestResult, eventId: UUID): Unit = PrimaryRecord.validateCaptureResult(event, result, eventId)
  private def existingEvent(c: Connection, graph: GraphSnapshot, request: IngestRequest, namespace: String): Option[(CapturedEvent, IngestResult, String)] = query(c, "SELECT * FROM ontology_captures WHERE scope = ? AND source_namespace = ? AND input_kind = 'Capture' AND event_id = ?")(p => { p.setString(1, request.scope); p.setString(2, namespace); p.setObject(3, request.eventId) }) { r =>
    if (!r.next()) None else {
      val record = eventRow(c, graph, r)
      record.outcome match {
        case PrimaryOutcome.Captured(result) => Some((record.event, result, record.fingerprint))
        case _ => throw Fault("corrupt", "generic capture expected")
      }
    }
  }
  def ingest(request: IngestRequest, principal: Principal, recorder: Actor, receivedAt: String, ingress: RequestTrace): IO[IngestResult] = database.transaction { c =>
    capture.validateIngress(request, principal)
    Contexts.server(ingress, Contexts.ProtocolLimits)
    lock(c, request.scope)
    val namespace = principal.credentialId
    val before = load(c, request.scope)
    val digest = Digests.text(StoredJson.encode(IngestRequest.codecJson, request))
    val priorRequest = query(c, "SELECT payload_digest, result FROM ontology_ingest_requests WHERE scope = ? AND source_namespace = ? AND request_id = ?")(p => { p.setString(1, request.scope); p.setString(2, namespace); p.setObject(3, request.requestId) })(r => if (r.next()) Some((r.getString(1), r.getString(2))) else None)
    priorRequest match {
      case Some((previous, stored)) =>
        Require(previous == digest, "replay-conflict", "request ID has different content")
        val (event, _, fingerprint) = existingEvent(c, before, request, namespace).getOrElse(throw Fault("corrupt", "ingest receipt has no captured event"))
        Require(fingerprint == CaptureIdentity.fingerprint(namespace, request), "corrupt", "ingest receipt event mismatch")
        val result = StoredJson.decode(IngestResult.codecJson, stored)
        validateResult(event, result, request.eventId)
        Require(result.requestId == request.requestId, "corrupt", "ingest request binding mismatch")
        result.copy(replayed = true)
      case None =>
        val fingerprint = CaptureIdentity.fingerprint(namespace, request)
        val result = existingEvent(c, before, request, namespace) match {
          case Some((_, stored, previous)) => Require(previous == fingerprint, "replay-conflict", "source event ID has different content"); stored.copy(requestId = request.requestId, replayed = true)
          case None =>
            validateContexts(c, principal, List(CaptureIdentity.occurrence(request), Contexts.contribution(request.contributionContext, ingress, Contexts.ProtocolLimits)))
            verified(c, before)
            val observed = before.sourceFrontier
            query(c, "SELECT COUNT(*), COALESCE(MAX(frontier), 0) FROM ontology_captures WHERE scope = ?")(_.setString(1, request.scope)) { r =>
              Require(r.next() && r.getLong(1) == observed && r.getLong(2) == observed, "corrupt", "source frontier range is incomplete")
            }
            val prior = query(c, "SELECT * FROM ontology_captures WHERE scope = ? AND source_namespace = ? ORDER BY frontier")(p => { p.setString(1, request.scope); p.setString(2, namespace) }) { r => val rows = List.newBuilder[CapturedEvent]; while (r.next()) rows += eventRow(c, before, r).event; rows.result() }
            val changed = capture(before, prior, observed, request, principal, recorder, receivedAt, ingress)
            saveGraph(c, before, changed.snapshot)
            saveInput(c, changed.receipt)
            savePrimary(c, PrimaryRecord(request.eventId, changed.event, fingerprint, PrimaryOutcome.Captured(changed.result)))
            changed.result
        }
        update(c, "INSERT INTO ontology_ingest_requests(scope, source_namespace, request_id, payload_digest, result) VALUES (?, ?, ?, ?, ?)")(p => { p.setString(1, request.scope); p.setString(2, namespace); p.setObject(3, request.requestId); p.setString(4, digest); p.setString(5, StoredJson.encode(IngestResult.codecJson, result)) })
        result
    }
  }
  def sources(request: SourceRequest): IO[SourceResult] = database.transaction { c =>
    val graph = load(c, request.scope)
    val current = graph.sourceFrontier
    Require(request.after >= 0 && request.after <= current && request.limit > 0 && request.limit < Int.MaxValue, "source-page", "invalid source page")
    val events = query(c, "SELECT * FROM ontology_captures WHERE scope = ? AND frontier > ? AND frontier <= ? ORDER BY frontier LIMIT ?")(p => { p.setString(1, request.scope); p.setLong(2, request.after); p.setLong(3, current); p.setInt(4, request.limit + 1) }) { r => val rows = List.newBuilder[CapturedEvent]; while (r.next()) rows += eventRow(c, graph, r).event; rows.result() }
    val expected = math.min(current - request.after, request.limit.toLong + 1L)
    Require(events.size.toLong == expected && events.zipWithIndex.forall { case (event, index) => event.frontier == request.after + index.toLong + 1L }, "corrupt", "source page contains an incomplete frontier range")
    val page = events.take(request.limit)
    SourceResult(request.scope, page, current, if (events.size > page.size) Some(page.last.frontier) else None)
  }
  def prepare(request: PresentRequest, call: ReviewCall, id: UUID, at: String): IO[Presentation] = database.transaction { c =>
    review.authorize(call, request.scope)
    lock(c, request.scope)
    val value = review.prepare(verified(c, load(c, request.scope)), request, call, id, at)
    val exists = query(c, "SELECT 1 FROM ontology_presentations WHERE scope = ? AND presentation_id = ?")(s => { s.setString(1, request.scope); s.setObject(2, id) })(_.next())
    Require(!exists, "identity", "presentation identity already exists")
    update(c, "INSERT INTO ontology_presentations(scope, presentation_id, owner_id, owner_kind, generation, reserved_source_id, payload_digest, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")(s => {
      s.setString(1, request.scope); s.setObject(2, id); s.setString(3, value.owner.id); s.setString(4, value.owner.kind.toString)
      s.setLong(5, value.payload.generation); s.setObject(6, value.reservedSourceRef.id); s.setString(7, value.payloadDigest); s.setString(8, StoredJson.encode(Presentation.codecJson, value))
    })
    value
  }
  def presentation(principal: Principal, scope: String, id: UUID): IO[Presentation] = database.transaction { c =>
    principal.require(scope, Capability.Read)
    loadPresentation(c, scope, id)
  }
  def judge(request: JudgmentRequest, call: ReviewCall, service: Actor, at: String): IO[Judgment] = database.transaction { c =>
    review.authorize(call, request.scope)
    lock(c, request.scope)
    val digest = Digests.text(Wire.encode(JudgmentRequest.codecJson, request).noSpaces)
    val prior = query(c, "SELECT payload_digest, capture_id FROM ontology_judgments WHERE scope = ? AND actor_kind = ? AND actor_id = ? AND request_id = ?")(s => {
      s.setString(1, request.scope); s.setString(2, call.principal.actor.kind.toString); s.setString(3, call.principal.actor.id); s.setObject(4, request.requestId)
    })(r => if (r.next()) Some((r.getString(1), r.getObject(2, classOf[UUID]))) else None)
    prior match {
      case Some((previous, captureId)) =>
        Require(previous == digest, "replay-conflict", "request ID has different content")
        loadJudgment(c, verified(c, load(c, request.scope)), captureId)
      case None =>
        val p = loadPresentation(c, request.scope, request.presentationId)
        val before = verified(c, load(c, request.scope))
        val existing = optionalInput(c, request.scope, review.publicationInput(p))
        val changed = review.publish(before, p, request, call, service, at, existing)
        val publication = changed.publicationReceipt.orElse(existing).getOrElse(throw Fault("invariant", "publication receipt missing"))
        review.validateEvidence(changed.snapshot, ReviewEvidence(p, changed.judgment, changed.event, changed.receipt, publication))
        saveGraph(c, before, changed.snapshot)
        changed.publicationReceipt.foreach(saveInput(c, _))
        saveInput(c, changed.receipt)
        savePrimary(c, PrimaryRecord(request.requestId, changed.event, CaptureIdentity.fingerprint(changed.event, request.requestId), PrimaryOutcome.Reviewed(changed.judgment)))
        update(c, "INSERT INTO ontology_judgments(scope, actor_id, actor_kind, request_id, judgment_id, presentation_id, capture_id, payload_digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")(s => {
          s.setString(1, request.scope); s.setString(2, call.principal.actor.id); s.setString(3, call.principal.actor.kind.toString)
          s.setObject(4, request.requestId); s.setObject(5, changed.judgment.id); s.setObject(6, p.id); s.setObject(7, changed.event.id); s.setString(8, digest)
        })
        verified(c, load(c, request.scope))
        changed.judgment
    }
  }
  def judgment(principal: Principal, scope: String, id: UUID): IO[Judgment] = database.transaction { c =>
    principal.require(scope, Capability.Read)
    val graph = verified(c, load(c, scope))
    val captureId = query(c, "SELECT capture_id FROM ontology_judgments WHERE scope = ? AND judgment_id = ? AND EXISTS (SELECT 1 FROM ontology_captures c WHERE c.scope = ontology_judgments.scope AND c.capture_id = ontology_judgments.capture_id AND c.frontier <= ?)")(s => { s.setString(1, scope); s.setObject(2, id); s.setLong(3, graph.sourceFrontier) }) { r =>
      Require(r.next(), "not-found", "judgment not found"); r.getObject(1, classOf[UUID])
    }
    loadJudgment(c, graph, captureId)
  }
  def judgments(principal: Principal, scope: String): IO[List[Judgment]] = database.transaction { c =>
    principal.require(scope, Capability.Read)
    val graph = verified(c, load(c, scope))
    query(c, "SELECT c.* FROM ontology_judgments j JOIN ontology_captures c ON c.scope = j.scope AND c.capture_id = j.capture_id WHERE j.scope = ? AND c.frontier <= ? ORDER BY c.frontier")(s => { s.setString(1, scope); s.setLong(2, graph.sourceFrontier) }) { r =>
      val values = List.newBuilder[Judgment]
      while (r.next()) eventRow(c, graph, r).outcome match {
        case PrimaryOutcome.Reviewed(value) => values += value
        case _ => throw Fault("corrupt", "judgment index points to a generic capture")
      }
      values.result()
    }
  }
  def outboxSnapshots(limit: Int): IO[List[GraphSnapshot]] = database.transaction { c =>
    Require(limit > 0, "limit", "positive projection batch required")
    query(c, "SELECT r.scope, r.generation, r.snapshot FROM ontology_outbox o JOIN ontology_revisions r USING(scope, generation) ORDER BY o.scope, o.generation LIMIT ?")(_.setInt(1, limit)) { r =>
      val rows = List.newBuilder[GraphSnapshot]; while (r.next()) rows += verified(c, decodeSnapshot(r.getString(1), r.getLong(2), r.getString(3))); rows.result()
    }
  }
  private def curationRead(c: Connection): CurationReadContext = curationTransaction(c)
  private def curationReadTransactions: CurationReadTransactions = new CurationReadTransactions {
    def run[A](scope: String)(body: CurationReadContext => A): IO[A] = database.transaction { c =>
      lock(c, scope)
      body(curationRead(c))
    }
  }
  private def curationTransactions: CurationTransactions = new CurationTransactions {
    def run[A](body: CurationTransaction => A): IO[A] = database.transaction { c =>
      query(c, "SELECT singleton FROM ontology_curation_coordinator WHERE singleton FOR UPDATE")(_ => ())(r => Require(r.next(), "corrupt", "coordinator row missing"))
      body(curationTransaction(c))
    }
  }
  private def curationTransaction(c: Connection): CurationTransaction = new CurationTransaction {
    def now: java.time.Instant = query(c, "SELECT clock_timestamp()")(_ => ()) { r =>
      Require(r.next(), "database", "database clock unavailable")
      r.getObject(1, classOf[java.time.OffsetDateTime]).toInstant
    }
    def coordinator: CoordinatorState = query(c, "SELECT epoch, payload FROM ontology_curation_coordinator WHERE singleton")(_ => ()) { r =>
      Require(r.next(), "corrupt", "coordinator row missing")
      CoordinatorState(r.getLong(1), Option(r.getString(2)).map(StoredJson.decode(CoordinatorLease.codecJson, _)))
    }
    def saveCoordinator(value: CoordinatorState): Unit = {
      val changed = update(c, "UPDATE ontology_curation_coordinator SET epoch = ?, payload = ? WHERE singleton") { p =>
        p.setLong(1, value.epoch)
        value.lease match {
          case Some(lease) => p.setString(2, StoredJson.encode(CoordinatorLease.codecJson, lease))
          case None => p.setNull(2, java.sql.Types.VARCHAR)
        }
      }
      Require(changed == 1, "corrupt", "coordinator row missing")
    }
    def lock(scope: String): Unit = PostgresGraphRepository.this.lock(c, scope)
    def head(scope: String): GraphSnapshot = verified(c, load(c, scope))
    def history(scope: String, generation: Long): GraphSnapshot = loadHistoryPrimary(c, scope, generation)
    def sources(graph: GraphSnapshot, after: Long): List[CapturedEvent] = {
      Require(after >= 0 && after <= graph.sourceFrontier, "corrupt", "invalid frozen source interval")
      val values = query(c, "SELECT * FROM ontology_captures WHERE scope = ? AND frontier > ? AND frontier <= ? ORDER BY frontier")(p => {
        p.setString(1, graph.scope); p.setLong(2, after); p.setLong(3, graph.sourceFrontier)
      }) { r => val result = List.newBuilder[CapturedEvent]; while (r.next()) result += eventRow(c, graph, r).event; result.result() }
      Require(values.size.toLong == graph.sourceFrontier - after, "corrupt", "incomplete frozen source interval")
      values
    }
    def containsAttempt(id: UUID): Boolean = query(c, "SELECT 1 FROM ontology_curation_attempts WHERE attempt_id = ?")(_.setObject(1, id))(_.next())
    private def journal(claim: CurationClaim): List[CurationAuditRecord] = {
      val id = claim.attemptId
      val maximum = CurationGuardLimits.retained(claim).maxOrdinals.toLong * 3L
      query(c,
      "SELECT ordinal, stage, payload FROM ontology_curation_audit WHERE attempt_id = ? ORDER BY ordinal, CASE stage WHEN 'RequestPrepared' THEN 0 WHEN 'DispatchPossible' THEN 1 WHEN 'ResponseObserved' THEN 2 END LIMIT ?")(
      p => { p.setObject(1, id); p.setLong(2, maximum + 1L) }) { r =>
      val result = List.newBuilder[CurationAuditRecord]
      while (r.next()) {
        val entry = StoredJson.decode(CurationAuditRecord.codecJson, r.getString(3))
        Require(entry.attemptId == id && entry.ordinal == r.getInt(1) && entry.stage.toString == r.getString(2), "corrupt", "audit row binding mismatch")
        result += entry
      }
      val values = result.result()
      Require(values.size.toLong <= maximum, "corrupt", "retained journal exceeds capacity")
      values
      }
    }
    private def read(r: ResultSet): CurationAttemptView = {
      val value = StoredJson.decode(CurationAttempt.codecJson, r.getString("payload"))
      val claim = value.claim
      val publicationGeneration = Option(r.getObject("publication_generation", classOf[java.lang.Long])).map(_.longValue())
      Require(value.publication.map(_.generation) == publicationGeneration, "corrupt", "publication generation row mismatch")
      Require(claim.attemptId == r.getObject("attempt_id", classOf[UUID]) && claim.scope == r.getString("scope") && claim.frontier == r.getLong("frontier") &&
        claim.fence.ownerId == r.getObject("owner_id", classOf[UUID]) && claim.fence.epoch == r.getLong("fence_epoch") && value.state.toString == r.getString("state"),
        "corrupt", "attempt row binding mismatch")
      CurationAttemptView(value, journal(claim))
    }
    def publications(scope: String, throughGeneration: Long): List[CurationAttemptView] = query(c,
      "SELECT * FROM ontology_curation_attempts WHERE scope = ? AND state = 'Published' AND publication_generation <= ? ORDER BY publication_generation")(
      p => { p.setString(1, scope); p.setLong(2, throughGeneration) }) { r =>
      val values = List.newBuilder[CurationAttemptView]; while (r.next()) values += read(r); values.result()
    }
    def find(scope: String, id: UUID): Option[CurationAttemptView] = query(c, "SELECT * FROM ontology_curation_attempts WHERE scope = ? AND attempt_id = ?")(
      p => { p.setString(1, scope); p.setObject(2, id) })(r => if (r.next()) Some(read(r)) else None)
    def latest(scope: String, publishedOnly: Boolean): Option[CurationAttemptView] = query(c,
      "SELECT * FROM ontology_curation_attempts WHERE scope = ? AND (NOT ? OR state = 'Published') ORDER BY frontier DESC LIMIT 1")(
      p => { p.setString(1, scope); p.setBoolean(2, publishedOnly) })(r => if (r.next()) Some(read(r)) else None)
    def olderActive(scopes: Set[String], fence: CoordinatorFence, limit: Int): List[CurationAttemptView] = {
      val names = c.createArrayOf("text", scopes.toList.sorted.toArray[AnyRef])
      try query(c, "SELECT * FROM ontology_curation_attempts WHERE scope = ANY (?) AND (owner_id <> ? OR fence_epoch <> ?) AND state IN ('Claimed', 'InputSealed', 'Running') ORDER BY scope, frontier LIMIT ?")(
        p => { p.setArray(1, names); p.setObject(2, fence.ownerId); p.setLong(3, fence.epoch); p.setInt(4, limit) }) { r =>
        val values = List.newBuilder[CurationAttemptView]; while (r.next()) values += read(r); values.result()
      } finally names.free()
    }
    def saveAttempt(value: CurationAttempt, insert: Boolean): Unit = {
      val claim = value.claim
      CurationGuards.validate(value, journal(claim), CurationGuardLimits.retained(claim))
      if (insert) {
        update(c, "INSERT INTO ontology_curation_attempts(attempt_id, scope, frontier, owner_id, fence_epoch, state, payload, publication_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")(p => {
          p.setObject(1, claim.attemptId); p.setString(2, claim.scope); p.setLong(3, claim.frontier); p.setObject(4, claim.fence.ownerId)
          p.setLong(5, claim.fence.epoch); p.setString(6, value.state.toString); p.setString(7, StoredJson.encode(CurationAttempt.codecJson, value))
          value.publication match { case Some(v) => p.setLong(8, v.generation); case None => p.setNull(8, java.sql.Types.BIGINT) }
        })
      } else {
        Require(find(claim.scope, claim.attemptId).exists(_.attempt.claim == claim), "corrupt", "attempt claim changed")
        val changed = update(c, "UPDATE ontology_curation_attempts SET state = ?, payload = ?, publication_generation = ? WHERE scope = ? AND attempt_id = ?")(p => {
          p.setString(1, value.state.toString); p.setString(2, StoredJson.encode(CurationAttempt.codecJson, value))
          value.publication match { case Some(v) => p.setLong(3, v.generation); case None => p.setNull(3, java.sql.Types.BIGINT) }
          p.setString(4, claim.scope); p.setObject(5, claim.attemptId)
        })
        Require(changed == 1, "corrupt", "attempt disappeared")
      }
      ()
    }
    def append(entry: CurationAuditRecord): Unit = {
      update(c, "INSERT INTO ontology_curation_audit(attempt_id, ordinal, stage, payload) VALUES (?, ?, ?, ?)")(p => {
        p.setObject(1, entry.attemptId); p.setInt(2, entry.ordinal); p.setString(3, entry.stage.toString); p.setString(4, StoredJson.encode(CurationAuditRecord.codecJson, entry))
      })
      ()
    }
    def input(scope: String, ref: Ref): InputReceipt = loadInput(c, scope, ref)
    def reviewEvidence(graph: GraphSnapshot, request: ApplyRequest): List[ReviewEvidence] = loadAdoptions(c, graph, Adoptions.claims(request))
    def savePublication(before: GraphSnapshot, value: PublishedCuration): Unit = {
      saveGraph(c, before, value.snapshot)
      saveInput(c, value.receipt)
      saveAttempt(value.attempt, false)
    }
  }
}
