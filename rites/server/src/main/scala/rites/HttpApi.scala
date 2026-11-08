package rites

import baboon.runtime.shared.BaboonJsonCodec
import cats.effect.{IO, Resource}
import cats.effect.std.Semaphore
import fs2.io.file.Files as Fs2Files
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, LinkOption, Path}
import java.util.UUID
import org.http4s.*
import org.http4s.dsl.io.*
import org.http4s.server.staticcontent.FileService
import org.typelevel.ci.CIString
import rites.api.*
import scala.concurrent.duration.*

final class HttpApi(config: Config, control: ControlService, store: RitesStore, logger: logstage.IzLogger) {
  private val cookieName = if (config.secureCookies) "__Host-rites_session" else "rites_session"
  private def header(request: Request[IO], name: String): Option[String] = request.headers.get(CIString(name)).map(_.head.value)
  private def noQuery(request: Request[IO]): Unit = { Check(request.uri.query.isEmpty, "invalid", "query parameters are not supported"); Check(header(request, "X-Rites-Version").forall(_ == "0.2.0"), "version-mismatch", "unsupported API version") }
  private def origin(request: Request[IO]): Unit = Check(header(request, "Origin").contains(config.allowedOrigin), "forbidden", "Origin not allowed")
  private def jsonContent(request: Request[IO]): Unit = Check(request.contentType.exists(_.mediaType == MediaType.application.json), "invalid", "Content-Type application/json required")
  private def cookie(request: Request[IO]): String = request.cookies.find(_.name == cookieName).map(_.content).getOrElse("")
  private def response(status: Status, json: io.circe.Json): Response[IO] = Response[IO](status).withEntity(json.noSpaces).putHeaders(Header.Raw(CIString("Content-Type"), "application/json"), Header.Raw(CIString("Cache-Control"), "no-store"), Header.Raw(CIString("X-Content-Type-Options"), "nosniff"), Header.Raw(CIString("Referrer-Policy"), "no-referrer"))
  private def encoded[A](codec: BaboonJsonCodec[A], value: A): Response[IO] = response(Status.Ok, JsonSupport.encode(codec, value))
  private def failure(error: DomainError): Response[IO] = {
    val status = error.code match {
      case "unauthorized" => Status.Unauthorized; case "forbidden" => Status.Forbidden; case "not-found" => Status.NotFound
      case "conflict" => Status.Conflict; case "too-large" => Status.PayloadTooLarge; case "unavailable" | "credential-unavailable" => Status.ServiceUnavailable
      case _ => Status.BadRequest
    }
    response(status, JsonSupport.encode(Failure.codecJson, Failure(error.code)))
  }
  private def sessionCookie(secret: String, age: Long): ResponseCookie = ResponseCookie(cookieName, secret, path = Some("/"), maxAge = Some(age), secure = config.secureCookies, httpOnly = true, sameSite = Some(SameSite.Strict))
  private def body[A](request: Request[IO], codec: BaboonJsonCodec[A])(use: A => IO[Response[IO]]): IO[Response[IO]] = {
    Check(request.contentLength.forall(_ <= config.maxBodyBytes), "too-large", "request body too large")
    request.body.take(config.maxBodyBytes.toLong + 1).compile.to(Array).timeout(30.seconds).flatMap { bytes =>
      IO(Check(bytes.length <= config.maxBodyBytes, "too-large", "request body too large")) *> IO {
        val text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString
        JsonSupport.decode(codec, JsonSupport.parse(text))
      }.flatMap(use)
    }
  }
  private def identity(request: Request[IO]): IO[Identity] = IO.blocking(controlMe(request))
  private def controlMe(request: Request[IO]): Identity = { noQuery(request); checkOriginOnRead(request); controlStoreAuthenticate(request) }
  private def checkOriginOnRead(request: Request[IO]): Unit = Check(header(request, "Origin").forall(_ == config.allowedOrigin), "forbidden", "Origin not allowed")
  private def controlStoreAuthenticate(request: Request[IO]): Identity = store.authenticate(cookie(request))
  private def mutation(request: Request[IO]): Identity = {
    noQuery(request); origin(request); jsonContent(request); Check(header(request, "Authorization").isEmpty, "forbidden", "browser cookie transport only")
    val identity = controlStoreAuthenticate(request); expectPrincipal(request, identity)
  }
  private def principalHeader(identity: Identity): Header.Raw = Header.Raw(CIString("X-Rites-User"), identity.userId)
  private def expectPrincipal(request: Request[IO], identity: Identity): Identity = {
    Check(header(request, "X-Rites-User").contains(identity.userId), "forbidden", "session principal changed"); identity
  }

  def routes(loginGate: Semaphore[IO]): HttpRoutes[IO] = HttpRoutes.of[IO] {
    case request @ GET -> Root / "api" / "version" => handle(IO { noQuery(request); encoded(VersionInfo.codecJson, control.versions) })
    case request @ POST -> Root / "api" / "login" => handle {
      IO { noQuery(request); origin(request); jsonContent(request); Check(header(request, "Authorization").isEmpty, "forbidden", "browser cookie transport only") } *>
        loginGate.permit.use(_ => body(request, LoginRequest.codecJson)(input => IO.blocking(control.login(input)).map(result => encoded(LoginResponse.codecJson, result.response).addCookie(sessionCookie(result.secret, config.sessionTtlSeconds.toLong)))))
    }
    case request @ GET -> Root / "api" / "me" => authenticated(request)(i => encoded(UserInfo.codecJson, control.me(i)))
    case request @ POST -> Root / "api" / "logout" => handle(IO.blocking {
      noQuery(request); origin(request); jsonContent(request); Check(header(request, "Authorization").isEmpty, "forbidden", "browser cookie transport only")
      val current = scala.util.Try(store.authenticate(cookie(request))).toOption
      current.foreach { identity => expectPrincipal(request, identity); control.logout(identity) }
      val base = response(Status.Ok, JsonSupport.encode(Ack.codecJson, Ack(true))).addCookie(sessionCookie("", 0))
      current.map(identity => base.putHeaders(principalHeader(identity))).getOrElse(base)
    })
    case request @ GET -> Root / "api" / "credentials" => authenticated(request)(i => encoded(CredentialsResult.codecJson, control.credentials(i)))
    case request @ PUT -> Root / "api" / "credentials" => withMutation(request, SaveCredentialRequest.codecJson)(input => i => encoded(CredentialResult.codecJson, control.saveCredential(i, input)))
    case request @ POST -> Root / "api" / "credentials" / "delete" => withMutation(request, DeleteCredentialRequest.codecJson)(input => i => encoded(Ack.codecJson, control.deleteCredential(i, input)))
    case request @ GET -> Root / "api" / "repositories" => authenticated(request)(i => encoded(RepositoriesResult.codecJson, control.repositories(i)))
    case request @ PUT -> Root / "api" / "repositories" => withMutation(request, SaveRepositoryRequest.codecJson)(input => i => encoded(RepositoryResult.codecJson, control.saveRepository(i, input)))
    case request @ POST -> Root / "api" / "repositories" / "delete" => withMutation(request, DeleteRepositoryRequest.codecJson)(input => i => encoded(Ack.codecJson, control.deleteRepository(i, input)))
    case request @ POST -> Root / "api" / "grants" => withMutation(request, SetGrantRequest.codecJson)(input => i => encoded(RepositoryResult.codecJson, control.setGrant(i, input)))
    case request @ GET -> Root / "api" / "repositories" / repository / "rites" => authenticated(request)(i => encoded(RitesResult.codecJson, control.rites(i, repository)))
    case request @ PUT -> Root / "api" / "rites" => withMutation(request, SaveRiteRequest.codecJson)(input => i => encoded(RiteResult.codecJson, control.saveRite(i, input)))
    case request @ POST -> Root / "api" / "rites" / "delete" => withMutation(request, DeleteRiteRequest.codecJson)(input => i => encoded(Ack.codecJson, control.deleteRite(i, input)))
    case request @ GET -> Root / "api" / "models" => authenticated(request)(_ => encoded(ModelsResult.codecJson, control.modelList))
    case request @ GET -> Root / "api" / "oauth-clients" => authenticated(request)(_ => encoded(OAuthClientsResult.codecJson, control.oauthClients))
    case request @ GET -> Root / "api" / "users" => authenticated(request)(i => encoded(UsersResult.codecJson, control.users(i)))
    case request @ GET -> Root / "api" / "status" => authenticated(request)(i => encoded(StatusInfo.codecJson, control.status(i)))
    case request @ POST -> Root / "api" / "runs" => withMutation(request, ManualRunRequest.codecJson)(input => i => encoded(RunResult.codecJson, control.manualRun(i, input)))
    case request @ GET -> Root / "api" / "runs" / id => authenticated(request)(i => encoded(RunResult.codecJson, control.run(i, UUID.fromString(id))))
    case request @ GET -> Root / "api" / "repositories" / repository / "rites" / rite / "runs" => authenticated(request)(i => encoded(RunsResult.codecJson, control.runs(i, repository, rite)))
    case request if request.method == Method.GET && !request.uri.path.renderString.startsWith("/api/") => static(request)
  }
  private def authenticated(request: Request[IO])(produce: Identity => Response[IO]): IO[Response[IO]] = handle(identity(request).flatMap(i => IO.blocking(produce(i)).map(_.putHeaders(principalHeader(i)))))
  private def withMutation[A](request: Request[IO], codec: BaboonJsonCodec[A])(produce: A => Identity => Response[IO]): IO[Response[IO]] = handle {
    IO.blocking(mutation(request)).flatMap { admitted =>
      body(request, codec)(input => IO.blocking {
        val current = expectPrincipal(request, store.current(admitted))
        produce(input)(current).putHeaders(principalHeader(current))
      })
    }
  }
  private def handle(io: IO[Response[IO]]): IO[Response[IO]] = IO.defer(io).handleErrorWith {
    case error: DomainError => IO.pure(failure(error))
    case _: IllegalArgumentException => IO.pure(failure(DomainError("invalid")))
    case _ => IO(logger.error("request failed")) *> IO.pure(failure(DomainError("unavailable")))
  }
  private def static(request: Request[IO]): IO[Response[IO]] = config.webRoot match {
    case None => NotFound()
    case Some(root) => IO.blocking {
      noQuery(request)
      val base = Path.of(root).toRealPath(); val relative = request.uri.path.renderString.stripPrefix("/")
      val candidate = base.resolve(if (relative.isEmpty) "index.html" else relative).normalize()
      if (!candidate.startsWith(base) || !Files.isRegularFile(candidate, LinkOption.NOFOLLOW_LINKS)) None else Some(candidate.toRealPath())
        .filter(_.startsWith(base))
    }.flatMap {
      case None => NotFound()
      case Some(file) => StaticFile.fromPath(fs2.io.file.Path.fromNioPath(file), Some(request)).getOrElseF(NotFound()).map { result =>
        val name = file.getFileName.toString.toLowerCase(java.util.Locale.ROOT); val html = name.endsWith(".html") || name.endsWith(".htm")
        result.putHeaders(Header.Raw(CIString("Cache-Control"), if (html) "no-store" else "public, max-age=3600"), Header.Raw(CIString("Content-Security-Policy"), "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"), Header.Raw(CIString("X-Content-Type-Options"), "nosniff"), Header.Raw(CIString("Referrer-Policy"), "no-referrer"))
      }
    }
  }
}
