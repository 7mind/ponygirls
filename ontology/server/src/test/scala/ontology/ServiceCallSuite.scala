package ontology

import munit.FunSuite
import ontology.api.*
import ontology.domain.Fault
import java.util.UUID

final class ServiceCallSuite extends FunSuite {
  private val human = Principal("human", Actor("viewer", ActorKind.Human), Set("scope"), Set(Capability.Read, Capability.Review))
  private def call(principal: Principal, session: Boolean): ServiceCall =
    ServiceCall.authenticated(Authenticated(principal, session, "fixture-digest", if (session) Some("fixture-session-digest") else None), "/api/v1/present", UUID.randomUUID())
  test("review capability carries independently checked cookie, Human and namespace requirements") {
    val accepted = ReviewCall.from(call(human, true), "scope")
    assertEquals(accepted.scope, "scope")
    assertEquals(accepted.principal, human)
    assertEquals(accepted.ingress.transport, RequestTransport.Cookie)
    val rejected = List(call(human, false),
      ServiceCall.internal(human, "fixture", UUID.randomUUID()),
      call(human.copy(actor = Actor("agent", ActorKind.Agent)), true),
      call(human.copy(capabilities = Set(Capability.Read)), true),
      call(human.copy(capabilities = Set(Capability.Review)), true),
      call(human.copy(scopes = Set("another")), true))
    rejected.foreach(value => assertEquals(intercept[Fault](ReviewCall.from(value, "scope")).code, "forbidden"))
  }
  test("request traces retain the supplied server identifier and transport without native metadata") {
    val id = UUID.randomUUID()
    val value = ServiceCall.authenticated(Authenticated(human, false, "fixture-digest", None), "/api/v1/read", id)
    assertEquals(value.ingress, RequestTrace(id, "/api/v1/read", RequestTransport.Bearer))
    assertEquals(intercept[Fault](ServiceCall.internal(human, "", id)).code, "context")
  }
}
