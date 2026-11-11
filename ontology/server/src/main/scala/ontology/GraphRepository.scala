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
  def prepare(request: PresentRequest, call: ReviewCall, id: java.util.UUID, at: String): IO[Presentation]
  def presentation(principal: Principal, scope: String, id: java.util.UUID): IO[Presentation]
  def judge(request: JudgmentRequest, call: ReviewCall, service: Actor, at: String): IO[Judgment]
  def judgment(principal: Principal, scope: String, id: java.util.UUID): IO[Judgment]
  def judgments(principal: Principal, scope: String): IO[List[Judgment]]
}
object Digests {
  def bytes(value: Array[Byte]): String = java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value))
  def text(value: String): String = bytes(value.getBytes(UTF_8))
}
final class MemoryGraphRepository(engine: AdmissionEngine, review: ReviewDomain) extends GraphRepository {
  private final case class Receipt(scope: String, actor: Actor, id: java.util.UUID)
  private var heads = Map.empty[String, GraphSnapshot]
  private var inputs = Map.empty[(String, Ref), InputReceipt]
  private var versions = Map.empty[(String, Long), GraphSnapshot]
  private var receipts = Map.empty[Receipt, (String, ApplyResult)]
  private var outbox = Map.empty[(String, Long), Boolean]
  private final case class SourceKey(scope: String, namespace: String, eventId: java.util.UUID)
  private final case class IngestKey(scope: String, namespace: String, requestId: java.util.UUID)
  private var sourceEvents = Map.empty[String, List[PrimaryRecord]]
  private var presentations = Map.empty[(String, java.util.UUID), Presentation]
  private var judgmentIndex = Map.empty[Receipt, (String, java.util.UUID)]
  private var sourceIndex = Map.empty[SourceKey, (String, IngestResult)]
  private var ingestReceipts = Map.empty[IngestKey, (String, IngestResult)]
  private val capture = new CaptureEngine
  private def verified(graph: GraphSnapshot): GraphSnapshot = {
    val events = sourceEvents.getOrElse(graph.scope, Nil).filter(_.event.frontier <= graph.sourceFrontier)
    SourceIntegrity.frontier(graph, events.map(_.event))
    events.foreach(validatePrimary(graph, _))
    PrimaryIntegrity.inventory(graph, events)
    graph
  }
  private def rawInput(scope: String, ref: Ref): InputReceipt = {
    val value = inputs.getOrElse((scope, ref), throw Fault("not-found", "input receipt not found"))
    Require(value.ref == ref && value.scope == scope && value.digest == Digests.text(value.content), "corrupt", "input receipt binding mismatch")
    InputReceipts.validateContext(value)
    value
  }
  private def rawPresentation(scope: String, id: java.util.UUID): Presentation = {
    val value = presentations.getOrElse((scope, id), throw Fault("not-found", "presentation not found"))
    Require(value.id == id && value.payload.scope == scope, "corrupt", "presentation binding mismatch")
    review.validatePresentation(value)
    value
  }
  private def reviewEvidence(graph: GraphSnapshot, record: PrimaryRecord): ReviewEvidence = record.outcome match {
    case PrimaryOutcome.Reviewed(value) =>
      val p = rawPresentation(graph.scope, value.presentationId)
      ReviewEvidence(p, value, record.event, rawInput(graph.scope, Ref(record.event.provenance.input, 1)), rawInput(graph.scope, review.publicationInput(p)))
    case _ => throw Fault("presentation", "linked review response required")
  }
  private def loadAdoptions(graph: GraphSnapshot, claims: List[AdoptionClaim]): List[ReviewEvidence] = claims.map { claim =>
    Require(claim.response.revision == 1, "presentation", "review response is immutable")
    val record = sourceEvents.getOrElse(graph.scope, Nil).find(_.event.id == claim.response.id).getOrElse(throw Fault("presentation", "review response not found"))
    Require(record.event.reviewResponse.exists(_.presentationId == claim.presentationId), "presentation", "presentation response pair mismatch")
    validatePrimary(graph, record)
    reviewEvidence(graph, record)
  }
  private def validatePrimary(graph: GraphSnapshot, record: PrimaryRecord): Unit = {
    val receipt = rawInput(graph.scope, Ref(record.event.provenance.input, 1))
    record.outcome match {
      case _: PrimaryOutcome.Captured =>
        val indexed = judgmentIndex.exists { case (key, (_, id)) => key.scope == graph.scope && id == record.event.id }
        PrimaryIntegrity.capture(graph, record, receipt, indexed)
      case PrimaryOutcome.Reviewed(value) =>
        PrimaryIntegrity.judgment(graph, record, reviewEvidence(graph, record), review)
        val indexed = judgmentIndex.getOrElse(Receipt(graph.scope, value.actor, value.requestId), throw Fault("corrupt", "judgment index missing"))
        Require(indexed == (receipt.digest, record.event.id), "corrupt", "judgment index mismatch")
    }
  }
  private def validateContexts(principal: Principal, contexts: List[ContextRecord]): Unit = {
    val keys = ContextAccess.requiredSnapshots(principal, contexts)
    val snapshots = keys.map(key => verified(versions.getOrElse((key.scope, key.generation), throw Fault("not-found", "graph revision not found"))))
    ContextAccess.validate(contexts, snapshots)
  }
  def read(scope: String): IO[GraphSnapshot] = IO(synchronized { verified(heads.getOrElse(scope, Graph.empty(scope))) })
  def history(scope: String, generation: Long): IO[GraphSnapshot] = IO(synchronized { verified(versions.getOrElse((scope, generation), throw Fault("not-found", "graph revision not found"))) })
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
        val claims = Adoptions.claims(request)
        if (claims.nonEmpty) admission.principal.require(request.scope, Capability.Read)
        validateContexts(admission.principal, List(context))
        val before = verified(heads.getOrElse(request.scope, Graph.empty(request.scope)))
        val changed = engine(before, request, admission.copy(reviewEvidence = loadAdoptions(before, claims)))
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
    val receipt = rawInput(scope, ref)
    if (Set(InputKind.Capture, InputKind.Judgment, InputKind.PresentationPublication).contains(receipt.kind)) {
      val graph = verified(heads.getOrElse(scope, Graph.empty(scope)))
      SourceIntegrity.linkedInput(graph, receipt)
    }
    receipt
  })
  def ingest(request: IngestRequest, principal: Principal, recorder: Actor, receivedAt: String, ingress: RequestTrace): IO[IngestResult] = IO(synchronized {
    capture.validateIngress(request, principal)
    Contexts.server(ingress, Contexts.ProtocolLimits)
    val receiptKey = IngestKey(request.scope, principal.credentialId, request.requestId)
    val requestDigest = Digests.text(Wire.encode(IngestRequest.codecJson, request).noSpaces)
    ingestReceipts.get(receiptKey) match {
      case Some((digest, result)) =>
        Require(digest == requestDigest, "replay-conflict", "request ID has different content")
        verified(heads.getOrElse(request.scope, Graph.empty(request.scope)))
        result.copy(replayed = true)
      case None =>
        val key = SourceKey(request.scope, principal.credentialId, request.eventId)
        val digest = CaptureIdentity.fingerprint(principal.credentialId, request)
        val result = sourceIndex.get(key) match {
          case Some((previous, existing)) =>
            Require(previous == digest, "replay-conflict", "source event ID has different content")
            verified(heads.getOrElse(request.scope, Graph.empty(request.scope)))
            existing.copy(requestId = request.requestId, replayed = true)
          case None =>
            validateContexts(principal, List(CaptureIdentity.occurrence(request), Contexts.contribution(request.contributionContext, ingress, Contexts.ProtocolLimits)))
            val before = verified(heads.getOrElse(request.scope, Graph.empty(request.scope)))
            val events = sourceEvents.getOrElse(request.scope, Nil)
            val frontier = events.lastOption.fold(0L)(_.event.frontier)
            val changed = capture(before, events.map(_.event), frontier, request, principal, recorder, receivedAt, ingress)
            Require(!inputs.contains((request.scope, changed.receipt.ref)), "identity", "input receipt already exists")
            inputs = inputs.updated((request.scope, changed.receipt.ref), changed.receipt)
            heads = heads.updated(request.scope, changed.snapshot)
            versions = versions.updated((request.scope, before.generation), before).updated((request.scope, changed.snapshot.generation), changed.snapshot)
            outbox = outbox.updated((request.scope, changed.snapshot.generation), false)
            sourceEvents = sourceEvents.updated(request.scope, events :+ PrimaryRecord(request.eventId, changed.event, digest, PrimaryOutcome.Captured(changed.result)))
            sourceIndex = sourceIndex.updated(key, (digest, changed.result))
            changed.result
        }
        ingestReceipts = ingestReceipts.updated(receiptKey, (requestDigest, result))
        result
    }
  })
  def sources(request: SourceRequest): IO[SourceResult] = IO(synchronized {
    val graph = verified(heads.getOrElse(request.scope, Graph.empty(request.scope)))
    val frontier = graph.sourceFrontier
    val events = sourceEvents.getOrElse(request.scope, Nil).map(_.event).filter(_.frontier <= frontier)
    Require(request.after >= 0 && request.after <= frontier && request.limit > 0 && request.limit < Int.MaxValue, "source-page", "invalid source page")
    val remaining = events.filter(_.frontier > request.after)
    val page = remaining.take(request.limit)
    SourceResult(request.scope, page, frontier, if (remaining.size > page.size) Some(page.last.frontier) else None)
  })
  def prepare(request: PresentRequest, call: ReviewCall, id: java.util.UUID, at: String): IO[Presentation] = IO(synchronized {
    review.authorize(call, request.scope)
    val value = review.prepare(verified(heads.getOrElse(request.scope, Graph.empty(request.scope))), request, call, id, at)
    Require(!presentations.contains((request.scope, id)), "identity", "presentation identity already exists")
    presentations = presentations.updated((request.scope, id), value)
    value
  })
  def presentation(principal: Principal, scope: String, id: java.util.UUID): IO[Presentation] = IO(synchronized {
    principal.require(scope, Capability.Read)
    rawPresentation(scope, id)
  })
  def judge(request: JudgmentRequest, call: ReviewCall, service: Actor, at: String): IO[Judgment] = IO(synchronized {
    review.authorize(call, request.scope)
    val key = Receipt(request.scope, call.principal.actor, request.requestId)
    val digest = Digests.text(Wire.encode(JudgmentRequest.codecJson, request).noSpaces)
    judgmentIndex.get(key) match {
      case Some((previous, captureId)) =>
        Require(previous == digest, "replay-conflict", "request ID has different content")
        verified(heads.getOrElse(request.scope, Graph.empty(request.scope)))
        sourceEvents.getOrElse(request.scope, Nil).find(_.event.id == captureId).map(_.outcome) match {
          case Some(PrimaryOutcome.Reviewed(value)) => value
          case _ => throw Fault("corrupt", "judgment primary record missing")
        }
      case None =>
        val p = rawPresentation(request.scope, request.presentationId)
        val before = verified(heads.getOrElse(request.scope, Graph.empty(request.scope)))
        val existing = inputs.get((request.scope, review.publicationInput(p)))
        val changed = review.publish(before, p, request, call, service, at, existing)
        val publication = changed.publicationReceipt.orElse(existing).getOrElse(throw Fault("invariant", "publication receipt missing"))
        review.validateEvidence(changed.snapshot, ReviewEvidence(p, changed.judgment, changed.event, changed.receipt, publication))
        val additions = changed.receipt :: changed.publicationReceipt.toList
        Require(additions.map(_.ref).distinct.size == additions.size && additions.forall(input => !inputs.contains((request.scope, input.ref))), "identity", "input receipt identity already exists")
        val primary = PrimaryRecord(request.requestId, changed.event, CaptureIdentity.fingerprint(changed.event, request.requestId), PrimaryOutcome.Reviewed(changed.judgment))
        val events = sourceEvents.getOrElse(request.scope, Nil) :+ primary
        SourceIntegrity.frontier(changed.snapshot, events.map(_.event))
        val nextInputs = inputs ++ additions.map(input => (request.scope, input.ref) -> input)
        val nextHeads = heads.updated(request.scope, changed.snapshot)
        val nextVersions = versions.updated((request.scope, before.generation), before).updated((request.scope, changed.snapshot.generation), changed.snapshot)
        val nextOutbox = outbox.updated((request.scope, changed.snapshot.generation), false)
        val nextEvents = sourceEvents.updated(request.scope, events)
        val nextIndex = judgmentIndex.updated(key, (digest, changed.event.id))
        inputs = nextInputs; heads = nextHeads; versions = nextVersions; outbox = nextOutbox; sourceEvents = nextEvents; judgmentIndex = nextIndex
        changed.judgment
    }
  })
  def judgment(principal: Principal, scope: String, id: java.util.UUID): IO[Judgment] = IO(synchronized {
    principal.require(scope, Capability.Read)
    verified(heads.getOrElse(scope, Graph.empty(scope)))
    val found = sourceEvents.getOrElse(scope, Nil).collect { case PrimaryRecord(_, _, _, PrimaryOutcome.Reviewed(value)) if value.id == id => value }
    Require(found.size <= 1, "corrupt", "duplicate judgment identity")
    found.headOption.getOrElse(throw Fault("not-found", "judgment not found"))
  })
  def judgments(principal: Principal, scope: String): IO[List[Judgment]] = IO(synchronized {
    principal.require(scope, Capability.Read)
    verified(heads.getOrElse(scope, Graph.empty(scope)))
    sourceEvents.getOrElse(scope, Nil).collect { case PrimaryRecord(_, _, _, PrimaryOutcome.Reviewed(value)) => value }
  })
  def pendingProjections(limit: Int): IO[List[GraphSnapshot]] = IO(synchronized {
    Require(limit > 0, "limit", "positive projection batch required")
    outbox.toList.collect { case (key, false) => key }.sortBy(x => (x._1, x._2)).take(limit).map(key => verified(versions(key)))
  })
  def acknowledgeProjection(scope: String, generation: Long): IO[Unit] = IO(synchronized {
    Require(outbox.contains((scope, generation)), "not-found", "unknown projected revision")
    outbox = outbox.updated((scope, generation), true)
  })
}
