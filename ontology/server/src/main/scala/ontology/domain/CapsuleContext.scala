package ontology.domain

import ontology.{Principal, ServiceCall, Wire}
import ontology.api.*

final case class WorkContextKey(scope: String, name: String)
final case class CapsuleSettings(contexts: Set[WorkContextKey], limits: CapsuleLimits) {
  Require(contexts.nonEmpty && contexts.forall(key => key.scope.trim.nonEmpty && key.name.trim.nonEmpty &&
    key.scope.length <= Contexts.MaximumTextLength && key.name.length <= Contexts.MaximumTextLength), "config", "explicit bounded capsule work contexts required")
  Require(limits.maxRecords > 0 && limits.maxPayloadBytes > 0 && limits.maxPayloadBytes <= Wire.MaxBodyBytes, "config", "invalid capsule payload bounds")
  def authorize(principal: Principal, scope: String, workContext: String): Unit = {
    principal.require(scope, Capability.Read)
    Require(contexts.contains(WorkContextKey(scope, workContext)), "work-context", "semantic work context is not configured")
  }
}
object CapsuleContext {
  val MissingReportedContext = "No reported capsule context was supplied"
  def reported(value: Option[ContextRecordInput]): ContextRecord = Contexts.normalize(value, MissingReportedContext, Contexts.ProtocolLimits)
  def authorize(call: ServiceCall, scope: String, workContext: String, settings: CapsuleSettings): Unit = {
    settings.authorize(call.principal, scope, workContext)
    Contexts.server(call.ingress, Contexts.ProtocolLimits)
    ()
  }
  def baseline(previous: Capsule, owner: Actor, scope: String, workContext: String, context: ContextRecord): Unit = {
    Require(previous.owner == owner && previous.payload.scope == scope && previous.payload.workContext == workContext, "forbidden", "capsule baseline owner or semantic context differs")
    Contexts.validateShape(context, Contexts.ProtocolLimits)
    Contexts.validateShape(previous.payload.reportedContext, Contexts.ProtocolLimits)
    val compatible = (previous.payload.reportedContext.origin, context.origin) match {
      case (OriginContext.ReportedNative(a), OriginContext.ReportedNative(b)) => a == b
      case _ => false
    }
    Require(compatible, "context", "capsule baseline requires matching reported native origin; Unknown is not a wildcard")
  }
  def delivery(capsule: Capsule, context: ContextRecord): Unit = {
    Contexts.validateShape(context, Contexts.ProtocolLimits)
    Require(capsule.payload.reportedContext.origin == context.origin, "context", "delivery reported origin differs from preparation")
  }
  def cut(status: CurationStatus): CapsuleCut = CapsuleCut(status.generation, status.frontier, status.coveredFrontier, status.lastPublicationGeneration, status.attempt)
  def comparison(prepared: CapsuleCut, observed: CapsuleCut): DeliveryCutComparison = {
    if (prepared.generation == observed.generation && prepared.frontier == observed.frontier && prepared.coveredFrontier == observed.coveredFrontier &&
      prepared.lastPublicationGeneration == observed.lastPublicationGeneration) DeliveryCutComparison.SameGraphAndCoverage
    else DeliveryCutComparison.ChangedGraphOrCoverage
  }
}
