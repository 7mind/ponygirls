package ponygirls.auth.http4s

import cats.effect.IO
import cats.syntax.all.*
import io.circe.Json
import org.http4s.{Header, MediaType, Method, Request, Response, Status}
import org.http4s.dsl.io.*
import org.typelevel.ci.CIString
import ponygirls.auth.{AccountEvent, AccountJson, AccountRefusal, AccountRefused, AccountReply, AccountSnapshot, Captured, CookieEffect,
  DeclarativeAccountService, ImperativeAccountApi, IndexingAccountEndpoint}
import ponygirls.auth.boundary.{BoundaryRefused, CredentialAccept, CredentialSelection, OriginPolicy, PresentedHeaders, Refusal,
  SecureAttribute, SessionCookie, SessionCookies}
import scala.concurrent.duration.FiniteDuration

/** A service's choices for its account plane. `current` is the configuration supplier of its transport decisions
  * (read again where a decision is taken); everything else is the service's policy. */
final case class AccountPlaneSettings[S](
  current: () => S,
  origins: S => OriginPolicy,
  cookies: SessionCookies,
  cookieOrder: SecureAttribute,
  /** A JSON response with the service's headers. */
  respond: (Status, Json) => Response[IO],
  /** The account failure code of an error: one of `AccountJson`'s codes; anything unknown is `unavailable`. */
  failureCode: Throwable => String,
  status: String => Status,
  /** One security event of a reply, written after its transaction committed. */
  audit: AccountEvent => IO[Unit],
  /** Ends whatever the service keeps open for a browser session that logout or a replacement ended. */
  endSession: String => IO[Unit],
  clientAddress: Request[IO] => String,
  /** The service's admission of an authenticated account request (for example its per-principal rate limit). */
  admitted: Captured => Unit,
  /** Labels a response with the authority checked last before its delivery. */
  delivered: (Response[IO], Captured) => Response[IO],
  bodyTimeout: FiniteDuration,
  /** Whether a `503` raised outside the shared dispatcher on its routes also carries `Retry-After`. */
  retryAfterOn503: Boolean,
  /** The scopes offered by the account read; issued tokens carry exactly these. */
  scopes: Vector[String])

/** The account plane under `/api/account/v1` over http4s: the five endpoints of the account protocol (login, account
  * read, token issue and revoke, logout), the imperative and indexing dispatch, and the boundary they share — exactly
  * one Host, at most one `Sec-Fetch-Site`, no query, `OriginPolicy.accountTransport`, bounded JSON bodies. Session
  * cookies are host-only, `HttpOnly`, `SameSite=Strict`. A request's credential is resolved by the shared service under
  * its own configuration snapshot; transport decisions read `settings.current`.
  */
final class AccountPlane[S <: AccountSnapshot[S]](service: DeclarativeAccountService[S], settings: AccountPlaneSettings[S]) {
  import AccountPlane.*
  private def refuse(refusal: Refusal): Nothing = throw BoundaryRefused(refusal)
  private def all(r: Request[IO], name: String): Vector[String] = r.headers.headers.filter(_.name == CIString(name)).map(_.value).toVector
  private def headers(r: Request[IO]): PresentedHeaders = AccountPlane.headers(r)
  private def respond(status: Status, value: Json): Response[IO] = settings.respond(status, value)
  private def cookie(secret: Option[String], secure: Boolean): Header.Raw =
    Header.Raw(CIString("Set-Cookie"), SessionCookie.serialize(settings.cookies.name(secure), secret, secure, settings.cookieOrder))
  private def accountBody(r: Request[IO]): IO[Json] = IO {
    if (r.uri.query.nonEmpty) refuse(Refusal.QueryParameters)
    if (!r.contentType.exists(_.mediaType == MediaType.application.json)) refuse(Refusal.JsonRequired)
    if (r.contentLength.exists(_ > BodyLimit)) refuse(Refusal.BodyTooLarge)
  } *> r.body.take(BodyLimit.toLong + 1).compile.to(Array).timeout(settings.bodyTimeout).map { bytes =>
    if (bytes.length > BodyLimit) refuse(Refusal.BodyTooLarge)
    AccountJson.parseUtf8(bytes)
  }
  private def boundary(r: Request[IO]): Unit = boundary(r, settings.current())
  private def boundary(r: Request[IO], s: S): Unit = {
    if (all(r, "Host").size != 1 || all(r, "Sec-Fetch-Site").size > 1) refuse(Refusal.AmbiguousHost)
    if (r.uri.query.nonEmpty) refuse(Refusal.QueryParameters)
    settings.origins(s).accountTransport(headers(r), safeRead = r.method == Method.GET, settings.cookies)
  }
  private def handled(operation: => IO[Response[IO]]): IO[Response[IO]] = IO.defer(operation).handleError { error =>
    val code = settings.failureCode(error)
    respond(settings.status(code), AccountJson.failure(code))
  }
  private def resolve(r: Request[IO]): IO[Captured] =
    service.resolve(s => CredentialSelection.resolve(settings.origins(s), settings.cookies, headers(r), CredentialAccept.BearerOrCookie, mutate = false))
  /** Initial auth admits bounded body work only. Dispatch must use the same still-current identity after that read. */
  private def revalidate(r: Request[IO], captured: Captured): IO[Captured] = resolve(r).map { current =>
    if (current.authority != captured.authority || current.presented.secret != captured.presented.secret || current.presented.cookie != captured.presented.cookie)
      throw AccountRefused(AccountRefusal.AuthorityChanged)
    current
  }
  private def authed(r: Request[IO], renew: Boolean)(f: Captured => IO[Response[IO]]): IO[Response[IO]] = IO.defer {
    boundary(r)
    resolve(r).flatMap { captured =>
      if (!captured.presented.cookie) throw AccountRefused(AccountRefusal.BrowserSessionRequired)
      IO(settings.admitted(captured)) *> f(captured).flatMap { response =>
        if (!renew) IO.pure(response)
        else IO(boundary(r)) *> revalidate(r, captured).map(current =>
          settings.delivered(response, current).putHeaders(cookie(Some(current.presented.secret), current.presented.secureCookie)))
      }
    }
  }
  /** After the body of an account mutation, under one current configuration: the boundary, and the credential the
    * request presents. While that is still the captured one, the mutation looks the session up itself, in its own
    * transaction before any effect, and no lookup is made here. Another credential is refused by the full check, with
    * its answers. */
  private def mutationBoundary(r: Request[IO], captured: Captured): IO[Unit] = IO.defer {
    val s = settings.current()
    boundary(r, s)
    val offered = CredentialSelection.resolve(settings.origins(s), settings.cookies, headers(r), CredentialAccept.BearerOrCookie, mutate = false)
    if (offered.secret == captured.presented.secret && offered.cookie == captured.presented.cookie) IO.unit else revalidate(r, captured).void
  }
  private def emptyBody(r: Request[IO], captured: Captured): IO[Unit] = accountBody(r).flatMap { raw =>
    if (!raw.asObject.exists(_.isEmpty)) refuse(Refusal.EmptyObjectRequired)
    mutationBoundary(r, captured)
  }
  /** Whether the request's session cookie is `Secure`, and the session secret it presents. */
  private def presented(s: S, r: Request[IO]): (Boolean, Option[String]) = {
    val h = headers(r)
    val secure = settings.origins(s).secureCookie(h)
    (secure, SessionCookie.select(h.cookie, settings.cookies.name(secure), settings.cookies.value))
  }
  /** Writes a dispatcher reply after its transaction committed, then its security events. */
  private def reply(reply: AccountReply, secure: Boolean, previous: Option[String]): IO[Response[IO]] = {
    val response = respond(Status.fromInt(reply.status).fold(throw _, identity), reply.body)
      .putHeaders(reply.retryAfterSeconds.toList.map(seconds => Header.Raw(CIString("Retry-After"), seconds.toString))*)
    reply.events.traverse_(settings.audit) *> (reply.cookie match {
      case CookieEffect.Keep => IO.pure(response)
      case CookieEffect.Set(secret) => previous.traverse_(settings.endSession).as(response.putHeaders(cookie(Some(secret), secure)))
    })
  }
  private def relative(r: Request[IO]): String = r.uri.path.renderString.stripPrefix(AccountRoot)
  /** Account paths added for imperative accounts, behind the same boundary as the five existing endpoints. The
    * configuration is taken again after the body was read: availability, cookie selection and dispatch never use
    * a snapshot older than the body. */
  private def imperative(r: Request[IO]): IO[Response[IO]] = {
    val entity = r.method == Method.POST || r.contentLength.exists(_ > 0) || r.isChunked
    (if (entity) accountBody(r).map(Some(_)) else IO.pure(None)).flatMap { body =>
      boundary(r)
      val s = settings.current()
      s.imperative match {
        case None => IO.pure(respond(Status.NotFound, AccountJson.failure(NotFound)))
        case Some(active) =>
          val (secure, previous) = presented(s, r)
          service.imperativeRequest(s, active, r.method.name, relative(r), body, all(r, ActorHeader), previous, settings.clientAddress(r))
            .flatMap(reply(_, secure, previous))
      }
    }
  }
  private def indexingBoundary(r: Request[IO], s: S): Unit = {
    boundary(r, s)
    if (r.method == Method.POST) {
      if (all(r, "Origin").size != 1) refuse(Refusal.OriginRequired)
      if (all(r, "Content-Type").size != 1) refuse(Refusal.OneContentTypeRequired)
    }
  }
  private def indexing(r: Request[IO]): IO[Response[IO]] = {
    val body: IO[Option[Json]] = if (r.method == Method.POST) accountBody(r).map(Some(_))
    else r.body.take(1).compile.last.timeout(settings.bodyTimeout).map { first =>
      if (first.nonEmpty || r.contentLength.exists(_ > 0)) refuse(Refusal.BodyOnGet)
      None
    }
    IO(indexingBoundary(r, settings.current())) *> body.flatMap { value =>
      val s = settings.current()
      indexingBoundary(r, s)
      val (secure, previous) = presented(s, r)
      service.indexingRequest(s, r.method.name, relative(r), value, all(r, ActorHeader), previous, settings.clientAddress(r))
        .flatMap(reply(_, secure, previous))
    }
  }
  /** The shared account protocol: a `503` raised outside the dispatcher once a request was routed to it (for
    * example an unavailable database or a reload that failed meanwhile) also carries `Retry-After` where the service
    * chose so. */
  private def dispatched(operation: => IO[Response[IO]]): IO[Response[IO]] = handled(operation).map { response =>
    if (!settings.retryAfterOn503 || response.status != Status.ServiceUnavailable || response.headers.get(CIString("Retry-After")).nonEmpty) response
    else response.putHeaders(Header.Raw(CIString("Retry-After"), ImperativeAccountApi.UnavailableRetryAfterSeconds.toString))
  }
  private val ok: Json = Json.obj("ok" -> Json.True)

  /** Every request under `/api/account/`. */
  val routes: PartialFunction[Request[IO], IO[Response[IO]]] = {
    case r @ POST -> Root / "api" / "account" / "v1" / "login" => handled {
      IO(boundary(r)) *> accountBody(r).flatMap { raw =>
        val s = settings.current()
        s.imperative match {
          case Some(active) =>
            boundary(r)
            val (secure, previous) = presented(s, r)
            dispatched(service.imperativeLogin(s, active, raw, previous, settings.clientAddress(r)).flatMap(reply(_, secure, previous)))
          case None =>
            val (login, password) = AccountJson.decodeLogin(raw)
            boundary(r)
            val h = headers(r)
            val secure = settings.origins(settings.current()).secureCookie(h)
            val previous = SessionCookie.select(h.cookie, settings.cookies.name(secure), settings.cookies.value)
            service.login(login, password, previous).flatMap { signed =>
              previous.traverse_(settings.endSession).as(respond(Status.Ok, Json.obj("user" -> AccountJson.user(signed.user))).putHeaders(cookie(Some(signed.session.secret), secure)))
            }
        }
      }
    }
    case r @ GET -> Root / "api" / "account" / "v1" => handled { authed(r, renew = true) { a =>
      service.account(a).map(view => respond(Status.Ok, AccountJson.account(view.user, view.tokens, settings.scopes)))
    }}
    case r @ POST -> Root / "api" / "account" / "v1" / "tokens" => handled { authed(r, renew = true) { a =>
      accountBody(r).flatMap { raw =>
        val (name, scopes) = AccountJson.decodeIssue(raw)
        mutationBoundary(r, a) *> service.issue(a, name, scopes, all(r, ActorHeader)).map(issued => respond(Status.Ok, AccountJson.issued(issued)))
      }
    }}
    case r @ POST -> Root / "api" / "account" / "v1" / "tokens" / id / "revoke" => handled { authed(r, renew = true) { a =>
      emptyBody(r, a) *> service.revoke(a, id, all(r, ActorHeader)).as(respond(Status.Ok, ok))
    }}
    case r @ POST -> Root / "api" / "account" / "v1" / "logout" => handled { authed(r, renew = false) { a =>
      emptyBody(r, a) *> service.logout(a, Some(all(r, ActorHeader))) *> settings.endSession(a.presented.secret)
        .as(respond(Status.Ok, ok).putHeaders(cookie(None, a.presented.secureCookie)))
    }}
    case r if r.uri.path.renderString.startsWith(AccountPrefix) && IndexingAccountEndpoint.route(r.method.name, relative(r)).nonEmpty => dispatched(indexing(r))
    case r if r.uri.path.renderString.startsWith(AccountPrefix) => handled { IO(boundary(r)) *> IO.defer {
      if (settings.current().imperative.isEmpty) IO.pure(respond(Status.NotFound, AccountJson.failure(NotFound))) else dispatched(imperative(r))
    }}
    case r if r.uri.path.renderString.startsWith(AccountSpace) => handled { IO { boundary(r); respond(Status.NotFound, AccountJson.failure(NotFound)) } }
  }
}
object AccountPlane {
  val AccountRoot = "/api/account/v1"
  private val AccountPrefix = AccountRoot + "/"
  private val AccountSpace = "/api/account/"
  val ActorHeader = "X-Account-Actor"
  private val NotFound = "not-found"
  private val BodyLimit = AccountJson.maxBodyBytes

  /** The headers the boundary reads: the first `Host` and `Sec-Fetch-Site` (the account boundary refuses more than one). */
  def headers(r: Request[IO]): PresentedHeaders = {
    def all(name: String): Vector[String] = r.headers.headers.filter(_.name == CIString(name)).map(_.value).toVector
    PresentedHeaders(all("Host").headOption.getOrElse(""), all("Authorization"), all("Cookie"), all("Origin"), all("Sec-Fetch-Site").headOption,
      all(OriginPolicy.AccountRequestHeader))
  }
  /** Fixed telemetry labels of the shared account endpoints. */
  def label(method: Method, path: String): Option[String] =
    Option.when(path.startsWith(AccountPrefix))(path.stripPrefix(AccountRoot)).flatMap { relative =>
      IndexingAccountEndpoint.route(method.name, relative).map("account" + _.path)
        .orElse(ImperativeAccountApi.route(method.name, relative).map("account" + _.endpoint.label))
    }
}
