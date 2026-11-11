package ontology.domain

import ontology.api.*

final case class ContextLimits(maxCuts: Int, maxRefsPerCut: Int, maxText: Int) {
  Require(maxCuts >= 0 && maxRefsPerCut >= 0 && maxText > 0, "config", "invalid context limits")
}

/** Claim consistency is not native attestation, permission or proof of inheritance. */
object Contexts {
  val MaximumCuts = 32
  val MaximumReferencesPerCut = 256
  val MaximumTextLength = 2048
  val ProtocolLimits = ContextLimits(MaximumCuts, MaximumReferencesPerCut, MaximumTextLength)
  val MissingOccurrence = "No source occurrence context was supplied"
  val MissingContribution = "No contribution context was supplied"

  private def check(value: Boolean, message: String): Unit = Require(value, "context", message)
  private def text(value: String, limits: ContextLimits): Unit =
    check(value.trim.nonEmpty && value.length <= limits.maxText, "empty or oversized context text")
  private def refs(values: List[Ref], limits: ContextLimits): Unit = {
    check(values.size <= limits.maxRefsPerCut && values.distinct == values, "duplicate or excessive context references")
    values.foreach(value => check(value.revision > 0, "invalid context reference revision"))
  }
  private def capture(value: CaptureContext, limits: ContextLimits): Unit = {
    text(value.sessionId, limits); text(value.branch, limits)
    value.rootSessionId.foreach(text(_, limits)); value.parentSessionId.foreach(text(_, limits))
    value.lineage match {
      case LineageStatus.Unknown => check(value.rootSessionId.isEmpty && value.parentSessionId.isEmpty, "unknown lineage cannot claim root or parent")
      case LineageStatus.Recorded =>
        check(value.rootSessionId.nonEmpty, "recorded lineage requires a root")
        value.parentSessionId.foreach(parent => check(parent != value.sessionId && !value.rootSessionId.contains(value.sessionId), "recorded child cannot identify itself as parent or root"))
    }
  }

  // Shape-only normalization never consults a later graph head during replay.
  def normalize(input: Option[ContextRecordInput], missingReason: String, limits: ContextLimits): ContextRecord = {
    val result = input match {
      case None => ContextRecord(OriginContext.Unknown(missingReason), Nil)
      case Some(value) =>
        val origin: OriginContext = value.origin match {
          case v: OriginContextInput.Unknown => OriginContext.Unknown(v.reason)
          case v: OriginContextInput.ReportedNative => OriginContext.ReportedNative(v.context)
        }
        ContextRecord(origin, value.reportedInherited)
    }
    validateShape(result, limits)
    result
  }

  def contribution(input: Option[ContextRecordInput], trace: RequestTrace, limits: ContextLimits): ContextRecord =
    if (input.isEmpty && trace.transport == RequestTransport.Internal) server(trace, limits)
    else normalize(input, MissingContribution, limits)

  def server(trace: RequestTrace, limits: ContextLimits): ContextRecord = {
    val result = ContextRecord(OriginContext.ServiceRequest(trace), Nil)
    validateShape(result, limits)
    result
  }

  def validateShape(value: ContextRecord, limits: ContextLimits): Unit = {
    value.origin match {
      case v: OriginContext.Unknown => text(v.reason, limits)
      case v: OriginContext.ReportedNative => capture(v.context, limits)
      case v: OriginContext.ServiceRequest => text(v.trace.operation, limits)
    }
    check(value.reportedInherited.size <= limits.maxCuts && value.reportedInherited.distinct == value.reportedInherited, "duplicate or excessive inherited cuts")
    value.reportedInherited.foreach { cut =>
      text(cut.sourceScope, limits)
      check(cut.generation >= 0 && cut.coveredFrontier >= 0 && cut.sourceFrontier >= cut.coveredFrontier, "invalid inherited generation or frontiers")
      refs(cut.bindingRefs, limits); refs(cut.sourceRefs, limits)
      check(cut.bindingRefs.size.toLong + cut.sourceRefs.size.toLong <= limits.maxRefsPerCut, "too many inherited references")
      cut.anchor.foreach { anchor =>
        val source = anchor match {
          case v: InheritanceAnchor.ReportedEpoch => v.source
          case v: InheritanceAnchor.ReportedParent =>
            check(cut.kind == InheritanceKind.Fork, "parent matching requires a reported Fork")
            v.source
        }
        check(cut.sourceRefs.contains(source), "native anchor must be listed in sourceRefs")
      }
    }
  }

  def nativeOption(value: ContextRecord): Option[CaptureContext] = value.origin match {
    case v: OriginContext.ReportedNative => Some(v.context)
    case _ => None
  }
  def reportedNative(value: ContextRecord, limits: ContextLimits): CaptureContext = {
    validateShape(value, limits)
    nativeOption(value).getOrElse(throw Fault("context-unknown", "reported native metadata is unavailable"))
  }

  /** The owner must authorize Read before loading every supplied frozen snapshot. */
  def validateInherited(value: ContextRecord, snapshots: List[GraphSnapshot], limits: ContextLimits): Unit = {
    validateShape(value, limits)
    value.reportedInherited.foreach { cut =>
      val matches = snapshots.filter(g => g.scope == cut.sourceScope && g.generation == cut.generation)
      check(matches.size == 1, "missing or ambiguous frozen source snapshot")
      val graph = matches.head
      Graph.validateCounters(graph)
      check(graph.sourceFrontier == cut.sourceFrontier && graph.coveredFrontier == cut.coveredFrontier, "inherited frontier does not match the frozen snapshot")
      cut.bindingRefs.foreach(ref => check(graph.bindings.exists(b => b.ref == ref && b.scope == cut.sourceScope), "inherited reference is not a binding in the source snapshot"))
      def source(ref: Ref): Content.Source = {
        val definition = Graph.node(graph, ref)
        check(definition.scope == cut.sourceScope, "source reference namespace mismatch")
        definition.content match {
          case v: Content.Source => v
          case _ => throw Fault("context", "inherited source reference is not a Source")
        }
      }
      cut.sourceRefs.foreach(ref => { source(ref); () })
      cut.anchor.foreach {
        case a: InheritanceAnchor.ReportedEpoch =>
          val original = reportedNative(source(a.source).captureContext, limits)
          check(original.epoch == a.epoch, "reported source epoch mismatch")
        case a: InheritanceAnchor.ReportedParent =>
          val original = reportedNative(source(a.source).captureContext, limits)
          val destination = reportedNative(value, limits)
          check(original.epoch == a.epoch, "reported parent source epoch mismatch")
          Require(original.lineage == LineageStatus.Recorded && destination.lineage == LineageStatus.Recorded, "context-unknown", "parent/root matching requires recorded lineage on both reported contexts")
          check(destination.parentSessionId.contains(original.sessionId), "reported parent session mismatch")
          check(destination.rootSessionId == original.rootSessionId, "reported root session mismatch")
      }
    }
  }
}
