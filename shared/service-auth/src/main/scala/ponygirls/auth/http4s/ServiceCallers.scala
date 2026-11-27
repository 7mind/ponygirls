package ponygirls.auth.http4s

import cats.effect.IO
import org.http4s.{Header, Request, Response}
import org.typelevel.ci.CIString
import ponygirls.auth.{AccountJson, AccountRefusal, AccountRefused, AccountSnapshot, CallerReads, CallerRefusal, CallerRefused, Captured,
  DeclarativeAccountService, Secrets}
import ponygirls.auth.boundary.{BoundaryRefused, CredentialAccept, CredentialSelection, OriginPolicy, Presented, Refusal, SecureAttribute, SessionCookie,
  SessionCookies}

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

/** How strictly a service's own routes treat an ambiguous request, before the credential is selected. No default. */
enum RequestAmbiguity {
  /** The first `Host` decides (a service that counts `Host` headers does so itself); a bearer token beside the session
    * cookie of the request's security class is ambiguous, beside the other class's cookie it is not looked at. */
  case FirstHostClassCookie
  /** Exactly one `Host` (`AmbiguousHost`), and a bearer token beside a session cookie of either name is ambiguous
    * (`AmbiguousCredentials`). */
  case OneHostAnyCookie
}

/** A service's choices for its own routes: its transport values (the same as its account plane's), how strictly it treats
  * ambiguity, and what it learns of a caller (`C`: `Captured` or `Identified`). */
final case class ServiceCallerSettings[S, C](origins: S => OriginPolicy, cookies: SessionCookies, cookieOrder: SecureAttribute,
  ambiguity: RequestAmbiguity, reads: CallerReads[C])

/** The callers of a service's own routes over the shared account service. `admit` before the body, `recheck` after the
  * body and after every wait, `renewed` on the response. Refusals: `BoundaryRefused` (transport, credential selection),
  * `AccountRefused` (no such credential, the authority changed), `CallerRefused` (the route's kind and actor rules); the
  * service maps each to its own failure. */
final class ServiceCallers[S <: AccountSnapshot[S], C](service: DeclarativeAccountService[S], settings: ServiceCallerSettings[S, C]) {
  import ServiceCallers.*
  /** The ambiguity rule, then the credential selection, under the configuration the decision reads. */
  private def selected(r: Request[IO], route: CallerRoute)(s: S): Presented = {
    val headers = AccountPlane.headers(r)
    settings.ambiguity match {
      case RequestAmbiguity.FirstHostClassCookie => ()
      case RequestAmbiguity.OneHostAnyCookie =>
        if (r.headers.headers.count(_.name == HostName) != 1) throw BoundaryRefused(Refusal.AmbiguousHost)
        // Presence alone: a bearer beside duplicate cookies of one name is ambiguous before the duplicates are looked at.
        val cookie = Vector(settings.cookies.secure, settings.cookies.plain).exists(SessionCookie.present(headers.cookie, _))
        if (headers.authorization.nonEmpty && cookie) throw BoundaryRefused(Refusal.AmbiguousCredentials)
    }
    CredentialSelection.resolve(settings.origins(s), settings.cookies, headers, route.accept, route.mutate)
  }
  private def identify(r: Request[IO], route: CallerRoute): IO[C] = settings.reads.read(service, selected(r, route))
  private def actors(r: Request[IO]): Vector[String] = r.headers.headers.filter(_.name == ActorName).map(_.value).toVector
  /** Before the body, in this order: the ambiguity rule, the transport and the one credential, the authority it resolves
    * to (with what `reads` names), the kind the route serves, the actor of a browser session. */
  def admit(r: Request[IO], route: CallerRoute): IO[C] = identify(r, route).map { caller =>
    val identified = settings.reads.captured(caller)
    val browser = identified.presented.cookie
    val served = route.serves match {
      case RouteCredential.Bearer => !browser
      case RouteCredential.BrowserSession => browser
      case RouteCredential.Either => true
    }
    if (!served) throw CallerRefused(CallerRefusal.CredentialKindNotServed)
    if (browser && route.actor == ActorRule.Required) {
      val offered = actors(r)
      if (offered.size != 1 || !offered.head.matches(ActorPattern)) throw CallerRefused(CallerRefusal.ActorRequired)
      if (!Secrets.equal(offered.head, AccountJson.actor(identified.authority.userId))) throw CallerRefused(CallerRefusal.ActorMismatch)
    }
    caller
  }
  /** After the body or a wait, under the current configuration: the request still presents the admitted credential and
    * it still authenticates the same authority; what `reads` names is read again. */
  def recheck(r: Request[IO], route: CallerRoute, admitted: Captured): IO[C] = identify(r, route).map { current =>
    val now = settings.reads.captured(current)
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
  private val HostName = CIString("Host")
  private val ActorPattern = "[0-9a-f]{64}"
  private val SetCookie = CIString("Set-Cookie")
}
