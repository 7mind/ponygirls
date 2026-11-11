package ontology

import cats.effect.IO
import ontology.api.*
import ontology.domain.*
import java.security.MessageDigest
import java.nio.charset.StandardCharsets.UTF_8

trait GraphRepository {
  def read(scope: String): IO[GraphSnapshot]
  def history(scope: String, generation: Long): IO[GraphSnapshot]
  def scopes: IO[List[String]]
  def apply(request: ApplyRequest, admission: Admission): IO[ApplyResult]
  def pendingProjections(limit: Int): IO[List[GraphSnapshot]]
  def acknowledgeProjection(scope: String, generation: Long): IO[Unit]
  def ingest(request: IngestRequest, principal: Principal, recorder: Actor, receivedAt: String, ingress: RequestTrace): IO[IngestResult]
  def input(scope: String, ref: Ref): IO[InputReceipt]
  def sources(request: SourceRequest): IO[SourceResult]
}
object Digests {
  def bytes(value: Array[Byte]): String = java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value))
  def text(value: String): String = bytes(value.getBytes(UTF_8))
}
final class MemoryGraphRepository(engine: AdmissionEngine) extends GraphRepository {
  private final case class Receipt(scope: String, actor: Actor, id: java.util.UUID)
  private var heads = Map.empty[String, GraphSnapshot]
  private var inputs = Map.empty[(String, Ref), InputReceipt]
  private var versions = Map.empty[(String, Long), GraphSnapshot]
  private var receipts = Map.empty[Receipt, (String, ApplyResult)]
  private var outbox = Map.empty[(String, Long), Boolean]
  private final case class SourceKey(scope: String, namespace: String, eventId: java.util.UUID)
  private final case class IngestKey(scope: String, namespace: String, requestId: java.util.UUID)
  private var sourceEvents = Map.empty[String, List[CapturedEvent]]
  private var sourceIndex = Map.empty[SourceKey, (String, IngestResult)]
  private var ingestReceipts = Map.empty[IngestKey, (String, IngestResult)]
  private val capture = new CaptureEngine
  private def validateContexts(principal: Principal, contexts: List[ContextRecord]): Unit = {
    val keys = ContextAccess.requiredSnapshots(principal, contexts)
    val snapshots = keys.map(key => versions.getOrElse((key.scope, key.generation), throw Fault("not-found", "graph revision not found")))
    ContextAccess.validate(contexts, snapshots)
  }
  def read(scope: String): IO[GraphSnapshot] = IO(synchronized { heads.getOrElse(scope, Graph.empty(scope)) })
  def history(scope: String, generation: Long): IO[GraphSnapshot] = IO(synchronized { versions.getOrElse((scope, generation), throw Fault("not-found", "graph revision not found")) })
  def scopes: IO[List[String]] = IO(synchronized { heads.keys.toList.sorted })
  def apply(request: ApplyRequest, admission: Admission): IO[ApplyResult] = IO(synchronized {
    Require(request.requestId == admission.requestId, "request", "request binding mismatch")
    admission.principal.require(request.scope, Capability.Mutate)
    val context = Contexts.contribution(request.contributionContext, admission.ingress, Contexts.ProtocolLimits)
    Contexts.server(admission.ingress, Contexts.ProtocolLimits)
    val key = Receipt(request.scope, admission.actor, request.requestId)
    val digest = Digests.text(Wire.encode(ApplyRequest.codecJson, request).noSpaces)
    receipts.get(key) match {
      case Some((previous, result)) => Require(previous == digest, "replay-conflict", "request ID has different content"); result.copy(replayed = true)
      case None =>
        validateContexts(admission.principal, List(context))
        val before = heads.getOrElse(request.scope, Graph.empty(request.scope))
        val changed = engine(before, request, admission)
        val receipt = InputReceipts.create(admission.provenance.input, request.scope, changed.snapshot.generation, InputKind.GraphMutation, admission.actor, admission.recorder, admission.actor, "ontology.api.ApplyRequest/0.1.0 canonical JSON", Wire.encode(ApplyRequest.codecJson, request).noSpaces, admission.recordedAt, context, admission.ingress)
        Require(!inputs.contains((request.scope, receipt.ref)), "identity", "input receipt already exists")
        heads = heads.updated(request.scope, changed.snapshot)
        inputs = inputs.updated((request.scope, receipt.ref), receipt)
        versions = versions.updated((request.scope, before.generation), before).updated((request.scope, changed.snapshot.generation), changed.snapshot)
        receipts = receipts.updated(key, (digest, changed.result))
        outbox = outbox.updated((request.scope, changed.snapshot.generation), false)
        changed.result
    }
  })
  def input(scope: String, ref: Ref): IO[InputReceipt] = IO(synchronized {
    val receipt = inputs.getOrElse((scope, ref), throw Fault("not-found", "input receipt not found"))
    InputReceipts.validateContext(receipt)
    receipt
  })
  def ingest(request: IngestRequest, principal: Principal, recorder: Actor, receivedAt: String, ingress: RequestTrace): IO[IngestResult] = IO(synchronized {
    capture.validateIngress(request, principal)
    Contexts.server(ingress, Contexts.ProtocolLimits)
    val receiptKey = IngestKey(request.scope, principal.credentialId, request.requestId)
    val requestDigest = Digests.text(Wire.encode(IngestRequest.codecJson, request).noSpaces)
    ingestReceipts.get(receiptKey) match {
      case Some((digest, result)) => Require(digest == requestDigest, "replay-conflict", "request ID has different content"); result.copy(replayed = true)
      case None =>
        val key = SourceKey(request.scope, principal.credentialId, request.eventId)
        val digest = CaptureIdentity.fingerprint(principal.credentialId, request)
        val result = sourceIndex.get(key) match {
          case Some((previous, existing)) => Require(previous == digest, "replay-conflict", "source event ID has different content"); existing.copy(requestId = request.requestId, replayed = true)
          case None =>
            validateContexts(principal, List(CaptureIdentity.occurrence(request), Contexts.contribution(request.contributionContext, ingress, Contexts.ProtocolLimits)))
            val before = heads.getOrElse(request.scope, Graph.empty(request.scope))
            val events = sourceEvents.getOrElse(request.scope, Nil)
            val frontier = events.lastOption.fold(0L)(_.frontier)
            val changed = capture(before, events, frontier, request, principal, recorder, receivedAt, ingress)
            Require(!inputs.contains((request.scope, changed.receipt.ref)), "identity", "input receipt already exists")
            inputs = inputs.updated((request.scope, changed.receipt.ref), changed.receipt)
            heads = heads.updated(request.scope, changed.snapshot)
            versions = versions.updated((request.scope, before.generation), before).updated((request.scope, changed.snapshot.generation), changed.snapshot)
            outbox = outbox.updated((request.scope, changed.snapshot.generation), false)
            sourceEvents = sourceEvents.updated(request.scope, events :+ changed.event)
            sourceIndex = sourceIndex.updated(key, (digest, changed.result))
            changed.result
        }
        ingestReceipts = ingestReceipts.updated(receiptKey, (requestDigest, result))
        result
    }
  })
  def sources(request: SourceRequest): IO[SourceResult] = IO(synchronized {
    val events = sourceEvents.getOrElse(request.scope, Nil)
    val frontier = events.lastOption.fold(0L)(_.frontier)
    Require(request.after >= 0 && request.after <= frontier && request.limit > 0 && request.limit < Int.MaxValue, "source-page", "invalid source page")
    val remaining = events.filter(_.frontier > request.after)
    val page = remaining.take(request.limit)
    SourceResult(request.scope, page, frontier, if (remaining.size > page.size) Some(page.last.frontier) else None)
  })
  def pendingProjections(limit: Int): IO[List[GraphSnapshot]] = IO(synchronized {
    Require(limit > 0, "limit", "positive projection batch required")
    outbox.toList.collect { case (key, false) => key }.sortBy(x => (x._1, x._2)).take(limit).map(versions)
  })
  def acknowledgeProjection(scope: String, generation: Long): IO[Unit] = IO(synchronized {
    Require(outbox.contains((scope, generation)), "not-found", "unknown projected revision")
    outbox = outbox.updated((scope, generation), true)
  })
}
