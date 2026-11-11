package ontology

import ontology.api.*
import ontology.domain.{Contexts, Require}
import java.util.UUID

final class ServiceCall private (val principal: Principal, val ingress: RequestTrace)
object ServiceCall {
  def authenticated(value: Authenticated, operation: String, hostRequestId: UUID): ServiceCall = {
    val transport = if (value.session) RequestTransport.Cookie else RequestTransport.Bearer
    val trace = RequestTrace(hostRequestId, operation, transport)
    Contexts.server(trace, Contexts.ProtocolLimits)
    new ServiceCall(value.principal, trace)
  }
  def internal(principal: Principal, operation: String, hostRequestId: UUID): ServiceCall = {
    val trace = RequestTrace(hostRequestId, operation, RequestTransport.Internal)
    Contexts.server(trace, Contexts.ProtocolLimits)
    new ServiceCall(principal, trace)
  }
}

final class ReviewCall private (val call: ServiceCall, val scope: String) {
  def principal: Principal = call.principal
  def ingress: RequestTrace = call.ingress
}
object ReviewCall {
  def from(call: ServiceCall, scope: String): ReviewCall = {
    Require(call.ingress.transport == RequestTransport.Cookie && call.principal.actor.kind == ActorKind.Human, "forbidden", "Human browser session required")
    call.principal.require(scope, Capability.Read)
    call.principal.require(scope, Capability.Review)
    new ReviewCall(call, scope)
  }
}
