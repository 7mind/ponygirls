package ponygirls.auth.http4s

import cats.effect.IO
import org.http4s.{Header, Request, Response}
import org.typelevel.ci.CIString
import ponygirls.auth.{AccountJson, AccountRefusal, AccountRefused, AccountSnapshot, CallerRefusal, CallerRefused, Captured, DeclarativeAccountService,
  Identified, Secrets}
import ponygirls.auth.boundary.{CredentialAccept, CredentialSelection, OriginPolicy, SecureAttribute, SessionCookie, SessionCookies}

/** Which kind of authenticated credential a service route serves. The other kind is refused after authentication
  * (`CallerRefusal.CredentialKindNotServed`), unlike `CredentialAccept.BearerOnly`, which refuses a session cookie before
  * any lookup. */
enum RouteCredential { case Bearer, BrowserSession, Either }
/** Whether a browser-session request of a route names its account with exactly one `X-Account-Actor` (the account
  * protocol's actor of the session owner). A bearer request never needs it. */
enum ActorRule { case Required, NotRequired }

/** How one of a service's own routes takes its caller: the credentials selection admits (`accept`), the kind the route
  * serves, whether a session cookie needs the same-origin proof of a write (`mutate`), and the actor rule. */
final case class CallerRoute(accept: CredentialAccept, serves: RouteCredential, mutate: Boolean, actor: ActorRule)

/** A service's transport choices for its own routes; the same values as its account plane's. */
final case class ServiceCallerSettings[S](origins: S => OriginPolicy, cookies: SessionCookies, cookieOrder: SecureAttribute)

/** The callers of a service's own routes over the shared account service. `admit` before the body, `recheck` after the
  * body and after every wait, `renewed` on the response. Refusals: `BoundaryRefused` (transport, credential selection),
  * `AccountRefused` (no such credential, the authority changed), `CallerRefused` (the route's kind and actor rules); the
  * service maps each to its own failure. */
final class ServiceCallers[S <: AccountSnapshot[S]](service: DeclarativeAccountService[S], settings: ServiceCallerSettings[S]) {
  import ServiceCallers.*
  private def identify(r: Request[IO], route: CallerRoute): IO[Identified] = {
    val headers = AccountPlane.headers(r)
    service.identify(s => CredentialSelection.resolve(settings.origins(s), settings.cookies, headers, route.accept, route.mutate))
  }
  private def actors(r: Request[IO]): Vector[String] = r.headers.headers.filter(_.name == ActorName).map(_.value).toVector
  /** Before the body, in this order: the transport and the one credential, the authority it resolves to (with its
    * display name and administrator flag), the kind the route serves, the actor of a browser session. */
  def admit(r: Request[IO], route: CallerRoute): IO[Identified] = identify(r, route).map { identified =>
    val browser = identified.captured.presented.cookie
    val served = route.serves match {
      case RouteCredential.Bearer => !browser
      case RouteCredential.BrowserSession => browser
      case RouteCredential.Either => true
    }
    if (!served) throw CallerRefused(CallerRefusal.CredentialKindNotServed)
    if (browser && route.actor == ActorRule.Required) {
      val offered = actors(r)
      if (offered.size != 1 || !offered.head.matches(ActorPattern)) throw CallerRefused(CallerRefusal.ActorRequired)
      if (!Secrets.equal(offered.head, AccountJson.actor(identified.captured.authority.userId))) throw CallerRefused(CallerRefusal.ActorMismatch)
    }
    identified
  }
  /** After the body or a wait, under the current configuration: the request still presents the admitted credential and
    * it still authenticates the same authority; the administrator flag is read again. */
  def recheck(r: Request[IO], route: CallerRoute, admitted: Captured): IO[Identified] = identify(r, route).map { current =>
    val now = current.captured
    if (now.authority != admitted.authority || now.presented.secret != admitted.presented.secret || now.presented.cookie != admitted.presented.cookie)
      throw AccountRefused(AccountRefusal.AuthorityChanged)
    current
  }
  /** The response with a browser session's cookie renewed (its persistent lifetime starts again). */
  def renewed(response: Response[IO], current: Captured): Response[IO] =
    if (!current.presented.cookie) response
    else response.putHeaders(Header.Raw(SetCookie, SessionCookie.serialize(settings.cookies.name(current.presented.secureCookie),
      Some(current.presented.secret), current.presented.secureCookie, settings.cookieOrder)))
}
object ServiceCallers {
  private val ActorName = CIString(AccountPlane.ActorHeader)
  private val ActorPattern = "[0-9a-f]{64}"
  private val SetCookie = CIString("Set-Cookie")
}
