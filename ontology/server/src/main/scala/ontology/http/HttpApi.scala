package ontology.http

import baboon.runtime.shared.BaboonJsonCodec
import cats.effect.IO
import cats.syntax.all.*
import io.circe.Json
import java.nio.ByteBuffer
import java.nio.charset.{CharacterCodingException, CodingErrorAction, StandardCharsets}
import java.nio.file.{Files, LinkOption, Path}
import logstage.IzLogger
import ontology.*
import ontology.api.*
import ontology.domain.{Fault, Require}
import org.http4s.*
import org.http4s.dsl.io.*
import org.typelevel.ci.CIString
import scala.concurrent.duration.*

private[http] object Transport {
  def all(request: Request[IO], name: String): List[String] =
    request.headers.headers.filter(_.name == CIString(name)).map(_.value).toList

  def authority(request: Request[IO]): RequestAuthority = RequestAuthority(
    all(request, "Host"), all(request, "Origin"), all(request, "Authorization"),
    all(request, "Cookie"), all(request, "X-Ontology-Actor")
  )

  def noQuery(request: Request[IO]): Unit =
    Require(request.uri.query.isEmpty, "bad-envelope", "query parameters are not supported")

  def rest(request: Request[IO]): Unit = {
    noQuery(request)
    Require(all(request, "X-Ontology-Version") == List(Wire.versions.current), "version-mismatch", "current API version required")
  }

  def bytes(value: Json): Array[Byte] = {
    val encoded = value.noSpaces.getBytes(StandardCharsets.UTF_8)
    Require(encoded.length <= Wire.MaxBodyBytes, "too-large", "encoded response exceeds limit; no content was truncated")
    encoded
  }

  def secure(response: Response[IO]): Response[IO] = response.putHeaders(
    Header.Raw(CIString("Cache-Control"), "private, no-store"),
    Header.Raw(CIString("X-Content-Type-Options"), "nosniff"),
    Header.Raw(CIString("Referrer-Policy"), "no-referrer")
  )

  def json(status: Status, value: Json): Response[IO] = secure(
    Response[IO](status).withEntity(bytes(value)).putHeaders(
      Header.Raw(CIString("Content-Type"), "application/json"),
      Header.Raw(CIString("X-Ontology-Version"), Wire.versions.current))
  )

  def encoded[A](codec: BaboonJsonCodec[A], value: A): Response[IO] =
    json(Status.Ok, Wire.encode(codec, value))

  def unexpected(error: Throwable): Boolean = error match {
    case f: Fault => Set("config", "internal", "unavailable").contains(f.code)
    case _ => true
  }

  // Fault codes are application-owned identifiers. Never expose exception detail,
  // submitted values, SQL diagnostics, filesystem paths or credential material.
  def publicFailure(error: Throwable): Failure = {
    val code = error match {
      case f: Fault if !unexpected(f) && f.code.matches("[a-z][a-z0-9-]{0,63}") => f.code
      case _ => "unavailable"
    }
    val message = code match {
      case "unauthorized" | "ambiguous-credentials" => "Authentication required."
      case "forbidden" => "Request is not permitted."
      case "not-found" => "Resource not found."
      case "version-mismatch" => "Unsupported API version."
      case "too-large" | "record-too-large" => "Request or response exceeds the size limit."
      case "request-timeout" => "Request body deadline exceeded."
      case "unsupported-media-type" => "UTF-8 application/json is required."
      case "not-acceptable" => "Unsupported response media types."
      case "unavailable" | "session-capacity" => "Service unavailable."
      case _ => "Request rejected."
    }
    Failure(code, message)
  }

  def status(code: String): Status = code match {
    case "unauthorized" | "ambiguous-credentials" => Status.Unauthorized
    case "forbidden" => Status.Forbidden
    case "not-found" => Status.NotFound
    case "conflict" | "replay-conflict" | "generation-conflict" | "stale-generation" | "stale-reference" | "stale-cursor" => Status.Conflict
    case "too-large" | "record-too-large" => Status.PayloadTooLarge
    case "request-timeout" => Status.RequestTimeout
    case "unsupported-media-type" => Status.UnsupportedMediaType
    case "not-acceptable" => Status.NotAcceptable
    case "unavailable" | "session-capacity" => Status.ServiceUnavailable
    case _ => Status.BadRequest
  }

  def failure(error: Throwable): Response[IO] = {
    val value = publicFailure(error)
    val response = json(status(value.code), Wire.encode(Failure.codecJson, value))
    if (response.status == Status.Unauthorized)
      response.putHeaders(Header.Raw(CIString("WWW-Authenticate"), "Bearer realm=\"ontology\""))
    else response
  }
}

final class HttpApi(auth: Auth, service: OntologyService, mcp: Mcp, webRoot: Option[Path], logger: IzLogger, newRequestId: () => java.util.UUID) {
  private val csp = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; object-src 'none'; worker-src 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"

  private def logUnavailable: IO[Unit] = IO(logger.error("ontology transport unavailable")).handleError(_ => ())
  private def report(error: Throwable): IO[Unit] = if (Transport.unexpected(error)) logUnavailable else IO.unit
  private def handled(work: => IO[Response[IO]]): IO[Response[IO]] =
    IO.defer(work).handleErrorWith(error => report(error) *> IO(Transport.failure(error)))

  private def readBytes(request: Request[IO]): IO[Array[Byte]] = IO {
    Transport.noQuery(request)
    val contentTypes = Transport.all(request, "Content-Type")
    val jsonType = "(?i)application/json(?:\\s*;\\s*charset\\s*=\\s*(?:utf-8|\"utf-8\"))?"
    Require(contentTypes.size == 1 && contentTypes.forall(_.trim.matches(jsonType)), "unsupported-media-type", "JSON content type required")
    Require(Transport.all(request, "Content-Encoding").isEmpty, "unsupported-media-type", "encoded bodies are not supported")
    val lengths = Transport.all(request, "Content-Length")
    Require(lengths.size <= 1, "bad-envelope", "duplicate content length")
    Require(lengths.isEmpty || Transport.all(request, "Transfer-Encoding").isEmpty, "bad-envelope", "ambiguous body framing")
    lengths.foreach { raw =>
      Require(raw.matches("[0-9]+"), "bad-envelope", "invalid content length")
      val length = scala.util.Try(raw.toLong).toOption.getOrElse(throw Fault("too-large", "content length exceeds limit"))
      Require(length <= Wire.MaxBodyBytes, "too-large", "body exceeds limit")
    }
  } *> request.body.take(Wire.MaxBodyBytes.toLong + 1).compile.to(Array)
    .timeoutTo(30.seconds, IO.raiseError(Fault("request-timeout", "body deadline exceeded")))
    .map { bytes =>
      Require(bytes.length <= Wire.MaxBodyBytes, "too-large", "body exceeds limit")
      bytes
    }

  private def body(request: Request[IO]): IO[Json] = readBytes(request).map(Wire.parse)

  private def admit(request: Request[IO], mutation: Boolean): IO[Authenticated] = IO.blocking {
    Transport.rest(request)
    auth.authenticate(Transport.authority(request), mutation, false)
  }

  private def current(request: Request[IO], captured: Authenticated, mutation: Boolean, isMcp: Boolean): IO[Authenticated] =
    IO.blocking(auth.revalidate(Transport.authority(request), captured, mutation, isMcp))

  private def authorized(request: Request[IO], mutation: Boolean)(use: Authenticated => IO[Response[IO]]): IO[Response[IO]] =
    admit(request, mutation).flatMap { captured =>
      IO.defer(use(captured)).attempt.flatMap { outcome =>
        // Check even failed operations before returning an authenticated response.
        current(request, captured, mutation, false) *> IO.fromEither(outcome)
      }
    }

  private def authorizedBody(request: Request[IO], captured: Authenticated, mutation: Boolean): IO[Json] =
    body(request).flatTap(_ => current(request, captured, mutation, false).void)

  private def post[A, B](request: Request[IO], input: BaboonJsonCodec[A], output: BaboonJsonCodec[B], mutation: Boolean, browserReview: Boolean)
    (use: (ServiceCall, A) => IO[B]): IO[Response[IO]] = handled {
    authorized(request, mutation) { captured =>
      IO {
        if (browserReview) Require(captured.session && captured.principal.actor.kind == ActorKind.Human,
          "forbidden", "browser Human session required")
      } *> authorizedBody(request, captured, mutation).flatMap(raw => IO(Wire.decode(input, raw))).flatMap { value =>
        current(request, captured, mutation, false).flatMap { checked =>
          IO.defer(use(ServiceCall.authenticated(checked, request.uri.path.renderString, newRequestId()), value))
        }
      }.map(value => Transport.encoded(output, value))
    }
  }

  private def login(request: Request[IO]): IO[Response[IO]] = handled {
    val headers = Transport.authority(request)
    IO {
      Transport.rest(request)
      auth.validateTransport(headers, true)
      Require(headers.authorization.isEmpty, "ambiguous-credentials", "login does not accept authorization")
    } *> body(request).flatMap(raw => IO(Wire.decode(LoginRequest.codecJson, raw))).flatMap { input =>
      IO.blocking {
        auth.validateTransport(headers, true)
        val session = auth.login(input.token, headers)
        // Verify the newly issued session, not a possibly expired login cookie.
        val issued = headers.copy(cookies = List(session.cookie.takeWhile(_ != ';')), expectedActor = Nil)
        val captured = auth.authenticate(issued, false, false)
        Require(captured.principal == session.principal, "unauthorized", "login principal changed")
        val response = Transport.encoded(LoginResult.codecJson, LoginResult(session.principal.identity, Wire.versions))
        auth.revalidate(issued, captured, false, false)
        response.putHeaders(Header.Raw(CIString("Set-Cookie"), session.cookie))
      }
    }
  }

  private def logout(request: Request[IO]): IO[Response[IO]] = handled {
    admit(request, true).flatMap { captured =>
      authorizedBody(request, captured, true).flatMap(raw => IO(Wire.decode(Ack.codecJson, raw))).flatMap { input =>
        IO.blocking {
          Require(input.ok, "bad-envelope", "logout acknowledgement required")
          val checked = auth.revalidate(Transport.authority(request), captured, true, false)
          val response = Transport.encoded(Ack.codecJson, Ack(true))
          // Logout intentionally invalidates this session. Construct the response
          // and validate immediately before invalidation, with no intervening await.
          val cookie = auth.logout(checked)
          response.putHeaders(Header.Raw(CIString("Set-Cookie"), cookie))
        }
      }
    }
  }

  private def mcpHandled(work: => IO[Response[IO]]): IO[Response[IO]] = IO.defer(work).handleErrorWith { error =>
    report(error) *> IO {
      val failure = Transport.publicFailure(error)
      val rpcCode = if (Set("unauthorized", "ambiguous-credentials").contains(failure.code)) -32001 else -32000
      val response = Transport.json(Transport.status(failure.code),
        Mcp.error(Json.Null, rpcCode, failure.message, Some(Wire.encode(Failure.codecJson, failure))))
      if (response.status == Status.Unauthorized)
        response.putHeaders(Header.Raw(CIString("WWW-Authenticate"), "Bearer realm=\"ontology\""))
      else response
    }
  }

  private def mcpRequest(request: Request[IO]): IO[Response[IO]] = mcpHandled {
    val headers = Transport.authority(request)
    IO.blocking {
      Transport.noQuery(request)
      auth.validateTransport(headers, false)
      Require(headers.cookies.isEmpty, "unauthorized", "MCP forbids cookies")
      val captured = auth.authenticate(headers, true, true)
      val protocols = Transport.all(request, "MCP-Protocol-Version")
      Require(protocols.isEmpty || protocols == List(Mcp.ProtocolVersion), "version-mismatch", "unsupported MCP protocol")
      val accepted = Transport.all(request, "Accept").flatMap(_.split(',').toList)
        .map(_.takeWhile(_ != ';').trim.toLowerCase(java.util.Locale.ROOT)).toSet
      Require(Set("application/json", "text/event-stream").subsetOf(accepted), "not-acceptable", "MCP accept types required")
      captured
    }.flatMap { captured =>
      readBytes(request).flatMap { bytes =>
        current(request, captured, true, true) *> IO(Wire.parse(bytes)).attempt.flatMap {
          case Left(f: Fault) if f.code == "bad-envelope" =>
            IO.pure(Some(Mcp.error(Json.Null, -32700, "Parse error", None)))
          case Left(error) => IO.raiseError(error)
          case Right(raw) =>
            mcp.handle(raw, mutation => current(request, captured, mutation, true).map(value => ServiceCall.authenticated(value, "/mcp", newRequestId())), logUnavailable)
        }
      }.map {
        case Some(reply) => Transport.json(Status.Ok, reply)
        case None => Transport.secure(Response[IO](Status.Accepted).putHeaders(Header.Raw(CIString("Content-Length"), "0")))
      }.flatTap(_ => current(request, captured, true, true).void)
    }
  }

  private def reserved(request: Request[IO], prefix: String): Boolean = {
    val path = request.uri.path.renderString
    path == "/" + prefix || path.startsWith("/" + prefix + "/")
  }

  def routes: HttpRoutes[IO] = HttpRoutes.of[IO] {
    case request @ GET -> Root / "api" / "v1" / "versions" => handled(IO {
      Transport.noQuery(request)
      auth.validateTransport(Transport.authority(request), false)
      Transport.encoded(VersionInfo.codecJson, Wire.versions)
    })
    case request @ POST -> Root / "api" / "v1" / "login" => login(request)
    case request @ POST -> Root / "api" / "v1" / "logout" => logout(request)
    case request @ GET -> Root / "api" / "v1" / "whoami" => handled {
      authorized(request, false)(captured => current(request, captured, false, false).map(a => Transport.encoded(Identity.codecJson, a.principal.identity)))
    }
    case request @ GET -> Root / "api" / "v1" / "limits" => handled {
      authorized(request, false) { captured =>
        current(request, captured, false, false).flatMap(a => service.limits(ServiceCall.authenticated(a, "/api/v1/limits", newRequestId()))).map(v => Transport.encoded(QueryLimitsResult.codecJson, v))
      }
    }
    case request @ GET -> Root / "api" / "v1" / "scopes" => handled {
      authorized(request, false) { captured =>
        current(request, captured, false, false).flatMap(a => service.scopes(ServiceCall.authenticated(a, "/api/v1/scopes", newRequestId()))).map(v => Transport.encoded(ScopesResult.codecJson, v))
      }
    }
    case r @ POST -> Root / "api" / "v1" / "find" => post(r, FindRequest.codecJson, FindResult.codecJson, false, false)(service.find)
    case r @ POST -> Root / "api" / "v1" / "read" => post(r, ReadRequest.codecJson, ReadResult.codecJson, false, false)(service.read)
    case r @ POST -> Root / "api" / "v1" / "sources" => post(r, SourceRequest.codecJson, SourceResult.codecJson, false, false)(service.sources)
    case r @ POST -> Root / "api" / "v1" / "status" => post(r, ScopeRequest.codecJson, CurationStatus.codecJson, false, false)(service.status)
    case r @ POST -> Root / "api" / "v1" / "present" => post(r, PresentRequest.codecJson, Presentation.codecJson, true, true)((call, input) => service.present(ReviewCall.from(call, input.scope), input))
    case r @ POST -> Root / "api" / "v1" / "judge" => post(r, JudgmentRequest.codecJson, Judgment.codecJson, true, true)((call, input) => service.judge(ReviewCall.from(call, input.scope), input))
    case r @ POST -> Root / "api" / "v1" / "judgments" => post(r, ScopeRequest.codecJson, JudgmentsResult.codecJson, false, false)(service.judgments)
    case r @ POST -> Root / "api" / "v1" / "apply" => post(r, ApplyRequest.codecJson, ApplyResult.codecJson, true, false)(service.apply)
    case r @ POST -> Root / "api" / "v1" / "ingest" => post(r, IngestRequest.codecJson, IngestResult.codecJson, true, false)(service.ingest)
    case r @ POST -> Root / "api" / "v1" / "capsule" => post(r, CapsuleRequest.codecJson, Capsule.codecJson, true, false)(service.capsule)
    case r @ POST -> Root / "api" / "v1" / "delivery" => post(r, DeliveryRequest.codecJson, DeliveryReceipt.codecJson, true, false)(service.delivery)
    case request @ POST -> Root / "mcp" => mcpRequest(request)
    case request if reserved(request, "mcp") => mcpHandled(IO {
      Transport.noQuery(request)
      val headers = Transport.authority(request)
      auth.validateTransport(headers, false)
      Require(headers.cookies.isEmpty, "unauthorized", "MCP forbids cookies")
      val exact = request.uri.path.renderString == "/mcp"
      val response = Transport.json(if (exact) Status.MethodNotAllowed else Status.NotFound,
        Mcp.error(Json.Null, -32601, "Method not found", None))
      if (exact) response.putHeaders(Header.Raw(CIString("Allow"), "POST")) else response
    })
    case request if reserved(request, "api") => handled(IO {
      Transport.rest(request)
      auth.validateTransport(Transport.authority(request), false)
      Transport.failure(Fault("not-found", "unknown API route"))
    })
    case request if request.method == Method.GET => handled(static(request))
    case request => handled(IO {
      Transport.noQuery(request)
      auth.validateTransport(Transport.authority(request), false)
      Transport.failure(Fault("not-found", "unknown route"))
    })
  }

  private def assetPath(raw: String): String = {
    Require(raw.startsWith("/") && raw.length <= 4096, "not-found", "invalid asset path")
    val builder = Array.newBuilder[Byte]
    var at = 0
    while (at < raw.length) {
      val c = raw.charAt(at)
      if (c == '%') {
        Require(at + 2 < raw.length, "not-found", "invalid path escape")
        val high = Character.digit(raw.charAt(at + 1), 16)
        val low = Character.digit(raw.charAt(at + 2), 16)
        Require(high >= 0 && low >= 0, "not-found", "invalid path escape")
        builder += ((high << 4) | low).toByte
        at += 3
      } else {
        Require(c <= 127, "not-found", "asset path must be URI encoded")
        builder += c.toByte
        at += 1
      }
    }
    val decoded = try StandardCharsets.UTF_8.newDecoder()
      .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
      .decode(ByteBuffer.wrap(builder.result())).toString
    catch { case _: CharacterCodingException => throw Fault("not-found", "invalid path encoding") }
    Require(!decoded.exists(c => c < ' ' || c == 127.toChar || c == '\\'), "not-found", "invalid path character")
    val relative = if (decoded == "/") "index.html" else decoded.drop(1)
    val parts = relative.split("/", -1).toList
    Require(parts.forall(p => p.nonEmpty && !p.startsWith(".")), "not-found", "invalid asset segment")
    Require(!Set("api", "mcp").contains(parts.head), "not-found", "reserved route")
    val name = parts.last.toLowerCase(java.util.Locale.ROOT)
    val extensions = List(".html", ".js", ".mjs", ".css", ".json", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf")
    Require(extensions.exists(name.endsWith), "not-found", "not a built asset")
    relative
  }

  private def static(request: Request[IO]): IO[Response[IO]] = IO {
    Transport.noQuery(request)
    auth.validateTransport(Transport.authority(request), false)
    assetPath(request.uri.path.renderString)
  }.flatMap { relative =>
    webRoot match {
      case None => IO.pure(Transport.failure(Fault("not-found", "web assets unavailable")))
      case Some(root) => IO.blocking {
        Require(root.isAbsolute, "config", "absolute web root required")
        val base = root.toRealPath()
        Require(Files.isDirectory(base), "config", "web root must be a directory")
        val candidate = base.resolve(relative).normalize()
        if (!candidate.startsWith(base) || !Files.isRegularFile(candidate)) None
        else {
          val resolved = candidate.toRealPath()
          if (!resolved.startsWith(base) || !Files.isRegularFile(resolved, LinkOption.NOFOLLOW_LINKS)) None
          else {
            Require(Files.size(resolved) <= Wire.MaxBodyBytes, "too-large", "asset exceeds response limit")
            Some(resolved)
          }
        }
      }.flatMap {
        case None => IO.pure(Transport.failure(Fault("not-found", "asset not found")))
        case Some(file) =>
          StaticFile.fromPath(fs2.io.file.Path.fromNioPath(file), Some(request))
            .getOrElseF(IO.pure(Transport.failure(Fault("not-found", "asset not found"))))
            .map(response => Transport.secure(response).putHeaders(
              Header.Raw(CIString("Content-Security-Policy"), csp),
              Header.Raw(CIString("X-Frame-Options"), "DENY")))
      }
    }
  }
}
