package manure

import cats.effect.{Deferred,IO,Resource}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import org.http4s.{Header,Method,Request,Uri}
import org.typelevel.ci.CIString
import manure.{api => wire}
import ponygirls.retrieval.UnavailableReason
import ponygirls.auth.{AccountJson,CredentialGate,FastPasswordHasher,Secrets,Totp}
import java.nio.file.Files
import java.util.UUID
import scala.concurrent.duration.*
import munit.FunSuite

/** Actual http4s adapter + real PG/FS; target-process/socket/browser legs are
  * additional suites, not substituted by these controlled request tests.
  */
final class HttpSuite extends FunSuite:
  private def request(method: Method,path: String,token: Option[String] = None,origin: Option[String] = None): Request[IO] =
    var r = Request[IO](method,Uri.unsafeFromString(path)).putHeaders(Header.Raw(CIString("Host"),"127.0.0.1:47329"))
    token.foreach(v => r = r.putHeaders(Header.Raw(CIString("Authorization"),"Bearer " + v)))
    origin.foreach(v => r = r.putHeaders(Header.Raw(CIString("Origin"),v)))
    r
  private val gate = CredentialGate.resource.use(IO.pure).unsafeRunSync()
  private def app(f: BackendFixture,adjust: Config => Config = c => c): Http =
    val config = adjust(f.config.copy(apiOrigin=ApiOrigin.parse("http://127.0.0.1:47329"),port=47329))
    val engine = SearchProjection.retrieval(config)
    val projection = new SearchProjection(config,engine)
    val auth = new Auth(config.users,config.accounts)
    val search = new Search(f.database.get,f.lease,config,auth,f.clock,engine,projection,None)
    val accounts = new Accounts(f.metadata,auth)
    new Http(config,f.artifacts,new Catalogue(f.artifacts,config.limits,f.clock),auth,f.clock,search,accounts,
      new AccountPlane(f.metadata,auth,accounts,gate,FastPasswordHasher,f.clock))
  private def command(c: wire.Command,token: Option[String],origin: Option[String] = None): Request[IO] =
    request(Method.POST,"/api/current",token,origin).withEntity(CurrentWire.encode(wire.ClientEnvelope.codecJson,
      wire.ClientEnvelope(UUID.fromString("01234567-89ab-4def-8123-456789abcdef"),"1.0.0",c)).noSpaces)
      .putHeaders(Header.Raw(CIString("Content-Type"),"application/json"))
  private def browserLogin(h: Http): IO[org.http4s.Response[IO]] = h.app.run(
    request(Method.POST,"/api/account/v1/login",None,Some("http://127.0.0.1:47329"))
      .withEntity("""{"login":"owner","password":"fixture-password"}""")
      .putHeaders(Header.Raw(CIString("Content-Type"),"application/json")))
  private def browserCookie(h: Http): IO[String] = browserLogin(h).map { response =>
    assertEquals(response.status.code,200)
    response.headers.headers.find(_.name == CIString("Set-Cookie")).get.value.takeWhile(_ != ';')
  }
  private def run(body: (BackendFixture,Http) => IO[Unit]): Unit = BackendFixture.resource(true).use(f => body(f,app(f))).unsafeRunSync()
  test("account settings requires browser authentication and static bearer cookies are not sessions") { run { (f,h) => for
    account <- h.app.run(request(Method.GET,"/api/account/v1"))
    _ <- IO(assertEquals(account.status.code,401))
    cookie <- h.app.run(command(wire.Command.Whoami(),None).putHeaders(Header.Raw(CIString("Cookie"),"manure-dev="+f.token)))
    _ <- IO(assertEquals(cookie.status.code,401))
    legacy <- h.app.run(command(wire.Command.Login(f.token),None,Some("http://127.0.0.1:47329")))
    _ <- IO { assertEquals(legacy.status.code,400); assert(!legacy.headers.headers.exists(_.name == CIString("Set-Cookie"))) }
  yield () }}
  test("domain dispatch rejects a session logged out while its Whoami body is held") { run { (f,h) =>
    val deadline = 10.seconds
    for
      cookie <- browserCookie(h)
      bodyStarted <- Deferred[IO,Unit]
      releaseBody <- Deferred[IO,Unit]
      original = command(wire.Command.Whoami(),None).putHeaders(Header.Raw(CIString("Cookie"),cookie))
      held = original.withBodyStream(fs2.Stream.eval(bodyStarted.complete(()).void *> releaseBody.get).drain ++ original.body)
      response <- Resource.make(h.app.run(held).start)(running => releaseBody.complete(()).void *> running.cancel).use { running => for
        _ <- bodyStarted.get
        logout <- h.app.run(request(Method.POST,"/api/account/v1/logout",None,Some("http://127.0.0.1:47329"))
          .withEntity("{}").putHeaders(Header.Raw(CIString("Content-Type"),"application/json"),
            Header.Raw(CIString("Cookie"),cookie),Header.Raw(CIString("X-Account-Actor"),ponygirls.auth.AccountJson.actor(f.identity.userId))))
        _ <- IO(assertEquals(logout.status.code,200))
        _ <- releaseBody.complete(())
        response <- running.joinWithNever
      yield response }.timeout(deadline)
      body <- response.as[String].map(text => CurrentWire.decode(wire.ServerEnvelope.codecJson,CurrentWire.parse(text)))
      _ <- IO {
        assertEquals(response.status.code,401)
        assertEquals(body.result.asInstanceOf[wire.Result.Error].failure.code,wire.ErrorCode.Unauthorized)
        assert(!response.headers.headers.exists(_.name == CIString("Set-Cookie")))
      }
    yield ()
  }}
  test("stale browser cookies do not prevent public shell loading and password reauthentication") { run { (f,h) => for
    cookie <- browserCookie(h)
    _ <- new Accounts(f.metadata,f.auth).logout(cookie.split("=",2)(1))
    shell <- h.app.run(request(Method.GET,"/").putHeaders(Header.Raw(CIString("Cookie"),cookie)))
    _ <- IO(assertEquals(shell.status.code,200))
    relogin <- h.app.run(request(Method.POST,"/api/account/v1/login",None,Some("http://127.0.0.1:47329"))
      .withEntity("""{"login":"owner","password":"fixture-password"}""").putHeaders(
        Header.Raw(CIString("Content-Type"),"application/json"),Header.Raw(CIString("Cookie"),cookie)))
    _ <- IO(assertEquals(relogin.status.code,200))
  yield () }}
  test("account mutations reject a stale settings actor before any token effect") { run { (f,h) => for
    cookie <- browserCookie(h)
    response <- h.app.run(request(Method.POST,"/api/account/v1/tokens",None,Some("http://127.0.0.1:47329"))
      .withEntity("""{"name":"stale-owner","scopes":["api"]}""").putHeaders(
        Header.Raw(CIString("Content-Type"),"application/json"),Header.Raw(CIString("Cookie"),cookie),
        Header.Raw(CIString("X-Account-Actor"),"0"*64)))
    _ <- IO(assertEquals(response.status.code,409))
    tokens <- new Accounts(f.metadata,f.auth).read(cookie.split("=",2)(1))
    _ <- IO(assert(!tokens._2.exists(_.name == "stale-owner")))
  yield () }}
  test("settings actor from owner A cannot issue/revoke/logout after another tab changes the cookie to owner B") { run { (f,_) =>
    val owner = f.config.users.find(_.id == f.identity.userId).get
    val h = app(f,c => c.copy(users=c.users :+ owner.copy(id="owner-B",tokens=Vector.empty,login=Some("owner-B"))))
    def account(method: Method,path: String,cookie: String,actors: Vector[String],body: String): Request[IO] =
      val req = request(method,path,None,Some("http://127.0.0.1:47329")).withEntity(body)
        .putHeaders(Header.Raw(CIString("Content-Type"),"application/json"),Header.Raw(CIString("Cookie"),cookie))
      req.withHeaders(org.http4s.Headers(req.headers.headers ++ actors.map(value => Header.Raw(CIString("X-Account-Actor"),value))))
    for
      cookieA <- browserCookie(h)
      settingsA <- h.app.run(account(Method.GET,"/api/account/v1",cookieA,Vector.empty,""))
      actorA <- settingsA.as[String].map(text => CurrentWire.parse(text).hcursor.downField("user").get[String]("actor").toOption.get)
      loginB <- h.app.run(request(Method.POST,"/api/account/v1/login",None,Some("http://127.0.0.1:47329"))
        .withEntity("""{"login":"owner-B","password":"fixture-password"}""").putHeaders(Header.Raw(CIString("Content-Type"),"application/json")))
      cookieB = loginB.headers.headers.find(_.name == CIString("Set-Cookie")).get.value.takeWhile(_ != ';')
      actorB = ponygirls.auth.AccountJson.actor("owner-B")
      _ <- Vector((Vector(actorA),409),(Vector.empty,400),(Vector(actorB,actorB),400),(Vector("invalid"),400)).traverse_ { (actors,status) =>
        h.app.run(account(Method.POST,"/api/account/v1/tokens",cookieB,actors,"""{"name":"stale-settings","scopes":["api"]}""")).flatMap(r => IO(assertEquals(r.status.code,status)))
      }
      listed <- h.app.run(account(Method.GET,"/api/account/v1",cookieB,Vector.empty,""))
      listing <- listed.as[String].map(CurrentWire.parse)
      _ <- IO(assertEquals(listing.hcursor.get[Vector[io.circe.Json]]("tokens").toOption.get,Vector.empty))
      issued <- h.app.run(account(Method.POST,"/api/account/v1/tokens",cookieB,Vector(actorB),"""{"name":"owner-B","scopes":["api"]}"""))
      token <- issued.as[String].map(CurrentWire.parse)
      id = token.hcursor.downField("token").get[String]("id").toOption.get
      revoked <- h.app.run(account(Method.POST,s"/api/account/v1/tokens/$id/revoke",cookieB,Vector(actorA),"{}"))
      logout <- h.app.run(account(Method.POST,"/api/account/v1/logout",cookieB,Vector(actorA),"{}"))
      intact <- h.app.run(account(Method.GET,"/api/account/v1",cookieB,Vector.empty,""))
      intactBody <- intact.as[String].map(CurrentWire.parse)
      _ <- IO {
        assertEquals(revoked.status.code,409); assertEquals(logout.status.code,409); assertEquals(intact.status.code,200)
        assertEquals(intactBody.hcursor.downField("tokens").downArray.get[Boolean]("revoked").toOption,Some(false))
      }
    yield ()
  }}
  test("account HTTP login/settings/one-time token/revoke/logout share only browser session authority") { run { (f,h) =>
    def account(method: Method,path: String,cookie: String,body: String): Request[IO] =
      request(method,path,None,Some("http://127.0.0.1:47329")).withEntity(body)
        .putHeaders(Header.Raw(CIString("Content-Type"),"application/json"),Header.Raw(CIString("Cookie"),cookie),
          Header.Raw(CIString("X-Account-Actor"),ponygirls.auth.AccountJson.actor(f.identity.userId)))
    for
      login <- browserLogin(h)
      loginBody <- login.as[String]
      cookie <- IO {
        assertEquals(login.status.code,200)
        assert(!loginBody.contains(f.token)); assert(!loginBody.contains("fixture-password"))
        val value = login.headers.headers.find(_.name == CIString("Set-Cookie")).get.value
        assert(value.contains("Max-Age=34560000")); assert(value.contains("HttpOnly; SameSite=Strict")); assert(!value.contains("Domain="))
        value.takeWhile(_ != ';')
      }
      settings <- h.app.run(account(Method.GET,"/api/account/v1",cookie,""))
      settingsBody <- settings.as[String].map(CurrentWire.parse)
      _ <- IO {
        assertEquals(settings.status.code,200)
        assertEquals(settingsBody.hcursor.downField("user").get[String]("id").toOption,Some(f.identity.userId))
        assertEquals(settingsBody.hcursor.downField("tokens").downArray.get[String]("source").toOption,Some("configured"))
      }
      issue <- h.app.run(account(Method.POST,"/api/account/v1/tokens",cookie,"""{"name":"terminal","scopes":["api"]}"""))
      issued <- issue.as[String].map(CurrentWire.parse)
      secret = issued.hcursor.get[String]("secret").toOption.get
      id = issued.hcursor.downField("token").get[String]("id").toOption.get
      _ <- IO(assertEquals(issue.status.code,200))
      who <- h.app.run(command(wire.Command.Whoami(),Some(secret)))
      _ <- IO(assertEquals(who.status.code,200))
      _ <- Vector(
        request(Method.GET,"/api/account/v1",Some(secret)),
        request(Method.GET,"/api/account/v1",Some(f.token)),
        command(wire.Command.Whoami(),Some(cookie.split("=",2)(1))),
        command(wire.Command.Whoami(),None).putHeaders(Header.Raw(CIString("Cookie"),"manure-dev="+secret))
      ).traverse_(r => h.app.run(r).flatMap(response => IO(assertEquals(response.status.code,401))))
      immutable <- h.app.run(account(Method.POST,"/api/account/v1/tokens/primary/revoke",cookie,"{}"))
      unknown <- h.app.run(account(Method.POST,"/api/account/v1/tokens/unknown/revoke",cookie,"{}"))
      invalidScope <- h.app.run(account(Method.POST,"/api/account/v1/tokens",cookie,"""{"name":"terminal","scopes":["admin"]}"""))
      _ <- IO { assertEquals(immutable.status.code,403); assertEquals(unknown.status.code,404); assertEquals(invalidScope.status.code,403) }
      listed <- h.app.run(account(Method.GET,"/api/account/v1",cookie,""))
      listedBody <- listed.as[String]
      _ <- IO { assert(!listedBody.contains(secret)); assert(listedBody.contains(id)) }
      revoke <- h.app.run(account(Method.POST,s"/api/account/v1/tokens/$id/revoke",cookie,"{}"))
      replay <- h.app.run(command(wire.Command.Whoami(),Some(secret)))
      logout <- h.app.run(account(Method.POST,"/api/account/v1/logout",cookie,"{}"))
      sessionReplay <- h.app.run(account(Method.GET,"/api/account/v1",cookie,""))
      configured <- h.app.run(command(wire.Command.Whoami(),Some(f.token)))
      _ <- IO {
        assertEquals(revoke.status.code,200); assertEquals(replay.status.code,401); assertEquals(logout.status.code,200)
        assertEquals(sessionReplay.status.code,401); assertEquals(configured.status.code,200)
        Vector(login,settings,issue,immutable,unknown,invalidScope,listed,revoke,logout,sessionReplay).foreach { response =>
          assert(response.headers.headers.exists(x => x.name == CIString("Cache-Control") && x.value == "no-store"))
        }
      }
    yield ()
  }}
  test("imperative signup, approval, login, profile, search and logout through the owner-key mapping in path mode") { run { (f,_) =>
    val origin = "http://127.0.0.1:47329"
    val key = Files.writeString(f.rootPath.resolveSibling("accounts.key"),Secrets.generate())
    val h = app(f,c => c.copy(users=c.users.map(u => if u.login.contains("loginonly") then u.copy(admin=true) else u),
      accounts=Some(AccountsConfig(true,Some(key),AccountSignupConfig(true,true,100),AccountsConfig.defaultEnrollment,"Manure (127.0.0.1)",Vector.empty))))
    val secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    val code = Totp.code(Totp.decodeSecret(secret).get,Totp.stepAt(java.time.Instant.ofEpochSecond(f.clock.now.toLong)))
    def account(method: Method,path: String,body: Option[String],cookie: Option[String],owner: Option[String]): Request[IO] =
      val base = request(method,"/api/account/v1" + path,None,Some(origin))
      val withBody = body.fold(base)(b => base.withEntity(b).putHeaders(Header.Raw(CIString("Content-Type"),"application/json")))
      withBody.putHeaders((cookie.map(v => Header.Raw(CIString("Cookie"),v)) ++ owner.map(id => Header.Raw(CIString("X-Account-Actor"),AccountJson.actor(id)))).toSeq.map(Header.ToRaw.rawToRaw)*)
    def setCookie(response: org.http4s.Response[IO]): Option[String] =
      response.headers.headers.find(_.name == CIString("Set-Cookie")).map(_.value.takeWhile(_ != ';'))
    val login = account(Method.POST,"/login",Some("""{"login":"alice","password":"synthetic alice password"}"""),None,None)
    for
      signup <- h.app.run(account(Method.POST,"/signup",Some(s"""{"username":"alice","email":"alice@example.test","password":"synthetic alice password","totpSecret":"$secret","totpCode":"$code","requireTotp":false}"""),None,None))
      signupBody <- signup.as[String]
      pending <- h.app.run(login)
      pendingBody <- pending.as[String]
      _ <- IO {
        assertEquals((signup.status.code,signupBody,setCookie(signup)),(202,"""{"status":"pending"}""",None))
        assertEquals((pending.status.code,CurrentWire.parse(pendingBody).hcursor.downField("error").get[String]("code").toOption),(403,Some("pending-approval")))
      }
      adminLogin <- h.app.run(account(Method.POST,"/login",Some("""{"login":"loginonly","password":"fixture-password"}"""),None,None))
      approved <- h.app.run(account(Method.POST,"/admin/users/alice/approve",Some("{}"),setCookie(adminLogin),Some("loginonly")))
      signedIn <- h.app.run(login)
      cookie = setCookie(signedIn).get
      profile <- h.app.run(account(Method.GET,"/profile",None,Some(cookie),None)).flatMap(_.as[String]).map(CurrentWire.parse(_).hcursor)
      owners <- f.database.get.transaction(c => Jdbc.rows(c,"SELECT owner FROM ponygirls_account_sessions")(_.getString(1)))
      initialized <- f.artifacts.init(f.identity,InitUpload("imperative needle",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None,Vector.empty,None,None))
      _ <- f.artifacts.finish(f.identity,initialized.artifact.id)
      found <- h.app.run(command(wire.Command.Search(wire.SearchQuery("needle",wire.SearchMode.Lexical,wire.SearchFilter(None,None,None,Nil,None,None),1,None)),None,Some(origin))
        .putHeaders(Header.Raw(CIString("Cookie"),cookie))).flatMap(_.as[String])
      logout <- h.app.run(account(Method.POST,"/logout",Some("{}"),Some(cookie),Some("alice")))
      replay <- h.app.run(account(Method.GET,"/profile",None,Some(cookie),None))
      _ <- IO {
        assertEquals((approved.status.code,signedIn.status.code),(200,200))
        assertEquals((profile.downField("user").get[String]("id").toOption,profile.get[String]("source").toOption),(Some("alice"),Some("imperative")))
        assert(owners.contains(SecretCodec.sha256("manure-account-owner-v1\u0000alice")) && !owners.contains("alice"),clue(owners))
        val page = CurrentWire.decode(wire.ServerEnvelope.codecJson,CurrentWire.parse(found)).result.asInstanceOf[wire.Result.SearchResults].page
        assertEquals(page.hits.map(_.artifact.artifactId),List(initialized.artifact.id))
        assertEquals((logout.status.code,replay.status.code),(200,401))
      }
    yield ()
  }}
  test("account boundary rejects wrong origins, duplicate credentials, oversized/ambiguous JSON and content contexts") { run { (f,h) =>
    def login(body: String): Request[IO] = request(Method.POST,"/api/account/v1/login",None,Some("http://127.0.0.1:47329"))
      .withEntity(body).putHeaders(Header.Raw(CIString("Content-Type"),"application/json"))
    for
      cookie <- browserCookie(h)
      _ <- Vector(
        (request(Method.GET,"/api/account/v1?x=secret"),400),
        (request(Method.GET,"/api/account/v1?"),400),
        (request(Method.GET,"/api/account/v1",None,Some("http://attacker.test")),403),
        (request(Method.POST,"/api/account/v1/login").withEntity("{}"),403),
        (request(Method.GET,"/api/account/v1",Some(f.token)).putHeaders(Header.Raw(CIString("Cookie"),cookie)),400),
        (request(Method.GET,"/api/account/v1").putHeaders(Header.Raw(CIString("Cookie"),cookie+"; "+cookie)),400),
        (login("""{"login":"owner","password":"fixture-password","password":"secret"}"""),400),
        (login("""{"login":"owner","password":"fixture-password","unknown":"secret"}"""),400),
        (login("[]"),400),
        (login("x"*16385),413),
        (login("["*9+"0"+"]"*9),400),
        (login("""{"login":"owner","password":"secret"}"""),401)
      ).traverse_ { (req,status) => h.app.run(req).flatMap { response => response.as[String].map { text =>
        assertEquals(response.status.code,status); assert(!text.contains("secret")); assert(!text.contains("fixture-password"))
        assert(CurrentWire.parse(text).hcursor.downField("error").get[String]("code").isRight)
      }}}
      repeated = request(Method.GET,"/api/account/v1")
      duplicateHeader <- h.app.run(repeated.withHeaders(repeated.headers ++ org.http4s.Headers(
        Header.Raw(CIString("Authorization"),"Bearer "+f.token),Header.Raw(CIString("Authorization"),"Bearer "+f.token))))
      _ <- IO(assertEquals(duplicateHeader.status.code,400))
      mounted <- h.app.run(request(Method.POST,"/view/"+("a"*32)+"/api/account/v1/login").withEntity("{}"))
      subdomain <- app(f,_.copy(contentMode="subdomain",contentSuffix="localhost")).app.run(
        login("{}").putHeaders(Header.Raw(CIString("Host"),("a"*32)+".localhost:47329")))
      _ <- IO { assertEquals(mounted.status.code,404); assertEquals(subdomain.status.code,404) }
    yield ()
  }}
  test("legacy form logout invalidates the server session as well as credential-bound content grants") { run { (f,h) => for
    cookie <- browserCookie(h)
    identity <- new Accounts(f.metadata,f.auth).browser(cookie.split("=",2)(1)).map(_.get)
    initialized <- f.artifacts.init(identity,InitUpload("logout",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None,Vector.empty,None,None))
    id = initialized.artifact.id
    _ <- f.artifacts.finish(identity,id)
    oneTime <- f.artifacts.createGrant(identity,id)
    (grant,_) <- f.artifacts.redeem(id,oneTime)
    logout <- h.app.run(request(Method.POST,"/api/current/logout",None,Some("http://127.0.0.1:47329"))
      .withEntity("").putHeaders(Header.Raw(CIString("Content-Type"),"application/x-www-form-urlencoded"),Header.Raw(CIString("Cookie"),cookie)))
    replay <- h.app.run(command(wire.Command.Whoami(),None).putHeaders(Header.Raw(CIString("Cookie"),cookie)))
    denied <- f.artifacts.contentInfo(id,Some(grant),None,None).attempt
    configured <- h.app.run(command(wire.Command.Whoami(),Some(f.token)))
    _ <- IO { assertEquals(logout.status.code,303); assertEquals(replay.status.code,401); assert(denied.isLeft); assertEquals(configured.status.code,200) }
  yield () }}
  test("dashboard favicon and shared ui assets are public, same-origin, without exposing other files") { run { (f,_) =>
    val directory = f.rootPath.resolve("dashboard-assets")
    val svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path d=\"M0 0h32v32H0z\"/></svg>"
    for
      _ <- IO.blocking {
        java.nio.file.Files.createDirectories(directory)
        java.nio.file.Files.writeString(directory.resolve("favicon.svg"),svg)
        java.nio.file.Files.writeString(directory.resolve("private.txt"),"not a dashboard asset")
        Vector("account.js","account-client.js","common.js","overlays.js","detail.js","upload.js").foreach(name => java.nio.file.Files.writeString(directory.resolve(name),"export {};"))
        java.nio.file.Files.writeString(directory.resolve("account.css"),"dialog { display: block; }")
        java.nio.file.Files.writeString(directory.resolve("upload.css"),"dialog { display: block; }")
        java.nio.file.Files.createDirectories(directory.resolve("ui/fonts"))
        java.nio.file.Files.writeString(directory.resolve("ui/tokens.css"),":root { --text: #000; }")
        java.nio.file.Files.write(directory.resolve("ui/fonts/InterVariable.woff2"),Array[Byte](119,79,70,50))
        java.nio.file.Files.writeString(directory.resolve("ui/README.md"),"not a dashboard asset")
      }
      h = app(f,_.copy(dashboardDir=Some(directory)))
      response <- h.app.run(request(Method.GET,"/favicon.svg"))
      body <- response.as[String]
      _ <- IO {
        assertEquals(response.status.code,200)
        assertEquals(body,svg)
        assertEquals(response.headers.headers.find(_.name == CIString("Content-Type")).map(_.value),Some("image/svg+xml"))
        val policy = response.headers.headers.find(_.name == CIString("Content-Security-Policy")).map(_.value).getOrElse("")
        Vector("default-src 'self'","script-src 'self'","object-src 'none'","base-uri 'none'","frame-ancestors 'none'","form-action 'self'")
          .foreach(directive => assert(policy.contains(directive),policy))
      }
      _ <- Vector("/account.js","/account-client.js","/account.css","/upload.css","/common.js","/overlays.js","/detail.js","/upload.js").traverse_(path => h.app.run(request(Method.GET,path)).flatMap(r => IO {
        assertEquals(r.status.code,200,path)
        assertEquals(r.headers.headers.find(_.name == CIString("Cache-Control")).map(_.value),Some("no-store"),path)
      }))
      _ <- Vector("/ui/tokens.css" -> "text/css; charset=utf-8","/ui/fonts/InterVariable.woff2" -> "font/woff2").traverse_ { (path,contentType) =>
        h.app.run(request(Method.GET,path)).flatMap(r => IO {
          assertEquals(r.status.code,200)
          assertEquals(r.headers.headers.find(_.name == CIString("Content-Type")).map(_.value),Some(contentType))
        })
      }
      _ <- Vector("/private.txt","/ui/README.md").traverse_(path => h.app.run(request(Method.GET,path)).flatMap(r => IO(assertEquals(r.status.code,404))))
    yield ()
  }}
  test("password retrieval is explicit, live-authenticated and strict cookie-Origin guarded") { run { (f,h) => for
    session <- browserCookie(h)
    a <- f.artifacts.init(f.identity,InitUpload("external",ArtifactKind.Directory,Visibility.External,Vector.empty,None,Vector.empty,None,None))
    c = wire.Command.GetExternalPassword(a.artifact.id)
    anonymous <- h.app.run(command(c,None))
    _ <- IO(assertEquals(anonymous.status.code,401))
    cookie <- h.app.run(command(c,None).putHeaders(Header.Raw(CIString("Cookie"),session)))
    _ <- IO(assertEquals(cookie.status.code,403))
    hostile <- h.app.run(command(c,Some(f.token),Some("http://attacker.test")))
    _ <- IO(assertEquals(hostile.status.code,403))
    allowed <- h.app.run(command(c,None,Some("http://127.0.0.1:47329")).putHeaders(Header.Raw(CIString("Cookie"),session)))
    response <- allowed.as[String].map(s => CurrentWire.decode(wire.ServerEnvelope.codecJson,CurrentWire.parse(s)))
    _ <- IO { assertEquals(allowed.status.code,200);assertEquals(response.result,wire.Result.ExternalPasswordRetrieved(a.externalPassword));assert(allowed.headers.headers.exists(x => x.name == CIString("Cache-Control") && x.value == "no-store")) }
    _ <- f.metadata.transaction(_.putExternalPassword(a.artifact.id,None))
    legacy <- h.app.run(command(c,Some(f.token)))
    legacyBody <- legacy.as[String].map(s => CurrentWire.decode(wire.ServerEnvelope.codecJson,CurrentWire.parse(s)))
    _ <- IO(assertEquals(legacyBody.result,wire.Result.ExternalPasswordRetrieved(None)))
    _ <- IO.blocking(java.nio.file.Files.writeString(f.config.users.find(_.id == f.identity.userId).get.tokens.head.hashFile,SecretCodec.sha256(SecretCodec.token())+"\n"))
    revoked <- h.app.run(command(c,Some(f.token)))
    _ <- IO(assertEquals(revoked.status.code,401))
  yield () }}
  test("recoverable password never enters ordinary management responses or sidecars") { run { (f,h) => for
    a <- f.artifacts.init(f.identity,InitUpload("no secret metadata",ArtifactKind.Directory,Visibility.External,Vector.empty,None,Vector.empty,None,None))
    _ <- IO.blocking {
      val sidecar=java.nio.file.Files.readString(f.rootPath.resolve("staging/"+a.artifact.id+".json"))
      assert(!sidecar.contains(a.externalPassword.get))
    }
    _ <- f.artifacts.finish(f.identity,a.artifact.id)
    _ <- Vector[wire.Command](wire.Command.GetArtifact(a.artifact.id),wire.Command.GetManifest(a.artifact.id),
      wire.Command.ListArtifacts(wire.CatalogueQuery("",false,None,None,wire.CatalogueSort.Name,wire.SortDirection.Asc,20,None,Nil,None,None))).traverse_ { c =>
      h.app.run(command(c,Some(f.token))).flatMap(r => r.as[String].map { text =>
        assertEquals(r.status.code,200);assert(!text.contains(a.externalPassword.get));assert(!text.contains("externalPassword"))
      })
    }
    _ <- f.metadata.transaction(_.putExternalPassword(a.artifact.id,Some(ExternalPasswordSecret("synthetic-integrity-mismatch"))))
    response <- h.app.run(command(wire.Command.GetExternalPassword(a.artifact.id),Some(f.token)))
    error <- response.as[String]
    _ <- IO { assertEquals(response.status.code,503);assert(!error.contains(a.externalPassword.get));assert(!error.contains("synthetic-integrity-mismatch"));assert(error.contains("Unavailable")) }
  yield () }}
  test("sole current generated route and unsupported version rejection; no old REST") { run { (f,h) => for
    version <- h.app.run(command(wire.Command.Version(),None))
    json <- version.as[String].map(CurrentWire.parse)
    decoded = CurrentWire.decode(wire.ServerEnvelope.codecJson,json)
    _ <- IO { assertEquals(version.status.code,200); assert(decoded.result.isInstanceOf[wire.Result.Version]) }
    old <- h.app.run(request(Method.GET,"/api/v1/artifacts",Some(f.token)))
    _ <- IO(assertEquals(old.status.code,404))
    rejected <- h.app.run(command(wire.Command.Version(),None).withEntity("""{"requestId":"01234567-89ab-4def-8123-456789abcdef","apiVersion":"0.0.0","command":{"Version":{}}}"""))
    _ <- IO(assertEquals(rejected.status.code,400))
  yield () }}
  test("anonymous capabilities advertise the exact policy used by current catalogue cursors") { run { (f,h) => for
    response <- h.app.run(command(wire.Command.GetCapabilities(),None))
    body <- response.as[String].map(s => CurrentWire.decode(wire.ServerEnvelope.codecJson,CurrentWire.parse(s)))
    capabilities = body.result.asInstanceOf[wire.Result.CapabilityInfo].capabilities
    query = wire.CatalogueQuery("Straße",false,None,None,wire.CatalogueSort.Name,wire.SortDirection.Asc,1,None,Nil,None,None)
    cursor = CataloguePolicy.encode(CataloguePolicy.Position(CataloguePolicy.Value.Text("Straße"),"a"*32),query)
    policy = CurrentWire.parse(Exact.string(java.util.Base64.getUrlDecoder.decode(cursor))).hcursor.get[String]("policy").toOption.get
    _ <- IO { assertEquals(response.status.code,200);assertEquals(policy,"utf8-casefold-16.0.0-v1");assertEquals(capabilities.cataloguePolicy,policy) }
  yield () }}
  test("host/origin/cookie-bearer ambiguity and static module containment") { run { (f,h) => for
    host <- h.app.run(command(wire.Command.Version(),None).putHeaders(Header.Raw(CIString("Host"),"attacker.test")))
    _ <- IO(assertEquals(host.status.code,400))
    wrong <- h.app.run(command(wire.Command.DeleteArtifact("a"*32),Some(f.token),Some("http://attacker.test")))
    _ <- IO(assertEquals(wrong.status.code,403))
    duplicate <- h.app.run(command(wire.Command.Whoami(),Some(f.token)).putHeaders(Header.Raw(CIString("Cookie"),"manure-dev="+f.token)))
    _ <- IO(assertEquals(duplicate.status.code,400))
    module <- h.app.run(request(Method.GET,"/current/manure/api/index.js"))
    _ <- IO(assertEquals(module.status.code,200))
    traversal <- h.app.run(request(Method.GET,"/current/../../manure/db.js"))
    _ <- IO(assertEquals(traversal.status.code,404))
  yield () }}
  test("generated management mutations require exact Origin for cookie but absent allowed bearer") { run { (f,h) =>
    val init = wire.Command.InitUpload("empty",wire.ArtifactKind.Directory,wire.Visibility.Internal,None,Nil,Nil,None,None)
    for
      session <- browserCookie(h)
      bearer <- h.app.run(command(init,Some(f.token)))
      _ <- IO(assertEquals(bearer.status.code,200))
      cookie <- h.app.run(command(init,None).putHeaders(Header.Raw(CIString("Cookie"),session)))
      _ <- IO(assertEquals(cookie.status.code,403))
      login <- browserLogin(h)
      _ <- IO { assertEquals(login.status.code,200); assert(login.headers.headers.exists(x => x.name == CIString("Set-Cookie") && x.value.contains("HttpOnly"))) }
      hostileForm <- h.app.run(request(Method.POST,"/api/current/logout",None,Some("http://attacker.test"))
        .withEntity("").putHeaders(Header.Raw(CIString("Content-Type"),"application/x-www-form-urlencoded"),Header.Raw(CIString("Cookie"),session)))
      _ <- IO(assertEquals(hostileForm.status.code,403))
    yield ()
  }}
  // Regression: browser login must not mint an agent cookie that makes GET / forbidden.
  for route <- Vector("generated","form") do
    test(s"legacy browser $route token login rejects humans and agents without a cookie; password login survives reload") { run { (f,h) =>
      def login(token: String): Request[IO] =
        if route == "generated" then command(wire.Command.Login(token),None,Some("http://127.0.0.1:47329"))
        else request(Method.POST,"/api/current/login",None,Some("http://127.0.0.1:47329"))
          .withEntity("token="+token).putHeaders(Header.Raw(CIString("Content-Type"),"application/x-www-form-urlencoded"))
      def cookies(response: org.http4s.Response[IO]): List[String] =
        response.headers.headers.filter(_.name == CIString("Set-Cookie")).map(_.value)
      val agentToken = SecretCodec.token()
      for
        _ <- IO.blocking(java.nio.file.Files.writeString(f.config.users.find(_.userType == "agent").get.tokens.head.hashFile,SecretCodec.sha256(agentToken)+"\n"))
        legacyHuman <- h.app.run(login(f.token))
        _ <- IO { assertEquals(legacyHuman.status.code,400); assert(cookies(legacyHuman).isEmpty) }
        human <- browserLogin(h)
        cookie <- IO {
          assertEquals(human.status.code,200)
          assertEquals(cookies(human).size,1)
          assert(cookies(human).head.contains("HttpOnly"))
          cookies(human).head.takeWhile(_ != ';')
        }
        _ <- Vector.fill(2)(()).traverse_ { _ =>
          h.app.run(request(Method.GET,"/").putHeaders(Header.Raw(CIString("Cookie"),cookie))).flatMap { response =>
            response.as[String].map { html => assertEquals(response.status.code,200); assert(html.contains("<html")) }
          }
        }
        who <- h.app.run(command(wire.Command.Whoami(),Some(agentToken)))
        principal <- who.as[String].map(s => CurrentWire.decode(wire.ServerEnvelope.codecJson,CurrentWire.parse(s)))
        _ <- IO { assertEquals(who.status.code,200); assert(principal.result.isInstanceOf[wire.Result.Identity]) }
        listed <- h.app.run(command(wire.Command.ListArtifacts(wire.CatalogueQuery("",false,None,None,wire.CatalogueSort.Name,wire.SortDirection.Asc,20,None,Nil,None,None)),Some(agentToken)))
        _ <- IO(assertEquals(listed.status.code,200))
        rejected <- h.app.run(login(agentToken))
        _ <- IO { assert(cookies(rejected).isEmpty,"rejected browser login must not set cookies"); assertEquals(rejected.status.code,400) }
      yield ()
    }}
  // Regression: direct path-mode navigation previously ignored the dashboard session.
  // Behavioral/blackbox with controlled PostgreSQL and filesystem dependencies.
  test("internal document navigation exchanges a human session for a scoped grant, never raw management access") { run { (f,h) =>
    val bytes = Exact.utf8("internal navigation fixture")
    def navigate(path: String,cookie: Option[String]): Request[IO] =
      val r = request(Method.GET,path).putHeaders(Header.Raw(CIString("Sec-Fetch-Mode"),"navigate"),
        Header.Raw(CIString("Sec-Fetch-Dest"),"document"),Header.Raw(CIString("Accept"),"text/html"))
      cookie.fold(r)(v => r.putHeaders(Header.Raw(CIString("Cookie"),v)))
    for
      a <- f.artifacts.init(f.identity,InitUpload("navigation",ArtifactKind.Directory,Visibility.Internal,
        Vector(ManifestEntry("index.html",false,bytes.length,SecretCodec.sha256(bytes)),ManifestEntry("nested/secret.md",false,bytes.length,SecretCodec.sha256(bytes))),None,Vector.empty,None,None))
      id = a.artifact.id
      _ <- f.artifacts.putChunk(f.identity,id,"nested/secret.md",0,bytes,SecretCodec.sha256(bytes))
      _ <- f.artifacts.putChunk(f.identity,id,"index.html",0,bytes,SecretCodec.sha256(bytes))
      _ <- f.artifacts.finish(f.identity,id)
      session <- browserCookie(h)
      _ <- Vector(s"/view/$id",s"/view/$id/nested/",s"/view/$id/nested/secret.md",s"/view/$id/__manure/view/nested/secret.md").traverse_ { path =>
        h.app.run(navigate(path,Some(session))).flatMap { r => IO {
          assertEquals(r.status.code,303)
          assertEquals(r.headers.headers.find(_.name == CIString("Location")).map(_.value),Some(if path == s"/view/$id" then path+"/" else path))
          assert(r.headers.headers.exists(_.name == CIString("Set-Cookie")))
        }}
      }
      handoff <- h.app.run(navigate(s"/view/$id/",Some(session)))
      grant <- IO {
        assertEquals(handoff.status.code,303)
        assertEquals(handoff.headers.headers.find(_.name == CIString("Location")).map(_.value),Some(s"/view/$id/"))
        assertEquals(handoff.headers.headers.count(_.name == CIString("Set-Cookie")),2)
        val cookie = handoff.headers.headers.find(h => h.name == CIString("Set-Cookie") && h.value.startsWith("mgrant-dev-")).get.value
        assert(cookie.startsWith("mgrant-dev-"+id+"=")); assert(cookie.contains(s"Path=/view/$id/; HttpOnly; SameSite=Lax"))
        assert(!cookie.contains(f.token)); cookie.takeWhile(_ != ';')
      }
      opened <- h.app.run(navigate(s"/view/$id/",Some(session+"; "+grant)))
      text <- opened.as[String]
      _ <- IO { assertEquals(opened.status.code,200); assertEquals(text,Exact.string(bytes)); assert(!opened.headers.headers.exists(_.name == CIString("Set-Cookie"))) }
      _ <- Vector(
        request(Method.GET,s"/view/$id/").putHeaders(Header.Raw(CIString("Cookie"),session)),
        navigate(s"/view/$id/__manure/raw/nested/secret.md",Some(session)),
        navigate(s"/view/$id/__manure/files/nested/secret.md/content",Some(session)),
        navigate(s"/view/$id/",None).putHeaders(Header.Raw(CIString("Authorization"),"Bearer "+f.token))
      ).traverse_ { req => h.app.run(req).flatMap(r => IO { assertEquals(r.status.code,401); assert(!r.headers.headers.exists(_.name == CIString("Set-Cookie"))) }) }
      bridge <- h.app.run(navigate(s"/view/$id/nested/?untrusted=https://attacker.test",None))
      bridgeHtml <- bridge.as[String]
      _ <- IO {
        assertEquals(bridge.status.code,200)
        assert(bridgeHtml.contains(s"0;url=/view/$id/nested/?manure-continue=1"))
        assert(bridgeHtml.contains(s"href=\"/view/$id/__manure/viewer/favicon.svg\""))
        assert(!bridgeHtml.contains("attacker.test")); assert(!bridgeHtml.contains("<script"))
        assert(bridge.headers.headers.exists(h => h.name == CIString("Content-Security-Policy") && h.value.contains("default-src 'none'")))
        assert(!bridge.headers.headers.exists(_.name == CIString("Set-Cookie")))
      }
      _ <- Vector("1","unknown","1&manure-continue=1").traverse_ { marker =>
        h.app.run(navigate(s"/view/$id/?manure-continue=$marker",None)).flatMap { r => r.as[String].flatMap { html => IO {
          assertEquals(r.status.code,401); assert(html.contains(s"/#/artifact/$id"))
          assert(html.contains(s"href=\"/view/$id/__manure/viewer/favicon.svg\""))
          assert(!html.contains("http-equiv=\"refresh\"")); assert(!r.headers.headers.exists(_.name == CIString("Set-Cookie")))
        }}}
      }
      resumed <- h.app.run(navigate(s"/view/$id/nested/?manure-continue=unknown&redirect=https://attacker.test",Some(session)))
      _ <- IO { assertEquals(resumed.status.code,303); assertEquals(resumed.headers.headers.find(_.name == CIString("Location")).map(_.value),Some(s"/view/$id/nested/")) }
      _ <- Vector(
        navigate(s"/view/$id/?manure-continue=1",None).putHeaders(Header.Raw(CIString("Origin"),"http://attacker.test")),
        navigate(s"/view/$id/",None).putHeaders(Header.Raw(CIString("Origin"),"null"))
      ).traverse_ { req => h.app.run(req).flatMap(r => IO { assertEquals(r.status.code,403); assert(!r.headers.headers.exists(_.name == CIString("Set-Cookie"))) }) }
      _ <- Vector(
        request(Method.GET,s"/view/$id/?manure-continue=1"),
        navigate(s"/view/$id/__manure/raw/nested/secret.md?manure-continue=1",None),
        navigate(s"/view/$id/__manure/files/nested/secret.md/content?manure-continue=1",None),
        navigate(s"/view/$id/?manure-continue=1",None).putHeaders(Header.Raw(CIString("Authorization"),"Bearer invalid"))
      ).traverse_ { req => h.app.run(req).flatMap(r => IO { assertEquals(r.status.code,401); assert(!r.headers.headers.exists(_.name == CIString("Set-Cookie"))) }) }
      apiMarker <- h.app.run(request(Method.POST,s"/view/$id/__manure/current?manure-continue=1").withEntity(
        CurrentWire.encode(wire.ContentEnvelope.codecJson,wire.ContentEnvelope(new UUID(0L,0L),"1.0.0",wire.ContentCommand.GetManifest())).noSpaces)
        .putHeaders(Header.Raw(CIString("Content-Type"),"application/json"),Header.Raw(CIString("Cookie"),session)))
      _ <- IO { assertEquals(apiMarker.status.code,401); assert(!apiMarker.headers.headers.exists(_.name == CIString("Set-Cookie"))) }
      escapedBridge <- h.app.run(navigate(s"/view/$id/a%22%3C%3E%26?manure-continue-fake=1",None))
      escapedHtml <- escapedBridge.as[String]
      _ <- IO { assertEquals(escapedBridge.status.code,200); assert(escapedHtml.contains(s"/view/$id/a%22%3C%3E%26?manure-continue=1")) }
      unknown <- h.app.run(navigate("/view/00000000000000000000000000000000/?manure-continue=1",None))
      _ <- IO(assertEquals(unknown.status.code,404))
      invalidBridge <- h.app.run(navigate(s"/view/$id/%2Fattacker.test",None))
      _ <- IO { assertEquals(invalidBridge.status.code,400); assert(!invalidBridge.headers.headers.exists(_.name == CIString("Set-Cookie"))) }
      hostile <- h.app.run(navigate(s"/view/$id/",Some(session)).putHeaders(Header.Raw(CIString("Origin"),"http://attacker.test")))
      _ <- IO { assertEquals(hostile.status.code,403); assert(!hostile.headers.headers.exists(_.name == CIString("Set-Cookie"))) }
      deep <- h.app.run(navigate(s"/view/$id/nested/secret.md",Some(grant)))
      deepText <- deep.as[String]
      _ <- IO { assertEquals(deep.status.code,200); assertEquals(deepText,Exact.string(bytes)) }
      viewer <- app(f,_.copy(viewerDir=None)).app.run(navigate(s"/view/$id/__manure/view/nested/secret.md",Some(grant)))
      viewerText <- viewer.as[String]
      _ <- IO { assertEquals(viewer.status.code,200); assertEquals(viewerText,Exact.string(bytes)) }
      invalid <- h.app.run(navigate(s"/view/$id/%2Fattacker.test",Some(session)))
      _ <- IO { assertEquals(invalid.status.code,400); assert(!invalid.headers.headers.exists(_.name == CIString("Set-Cookie"))) }
      ambiguous <- h.app.run(navigate(s"/view/$id/",Some(session)).putHeaders(Header.Raw(CIString("Authorization"),"Bearer "+f.token)))
      _ <- IO { assertEquals(ambiguous.status.code,400); assert(!ambiguous.headers.headers.exists(_.name == CIString("Set-Cookie"))) }
      sub = app(f,_.copy(contentMode="subdomain",contentSuffix="localhost"))
      isolated <- sub.app.run(navigate("/",Some(session)).putHeaders(Header.Raw(CIString("Host"),id+".localhost:47329")))
      _ <- IO { assertEquals(isolated.status.code,401); assert(!isolated.headers.headers.exists(_.name == CIString("Set-Cookie"))) }
      other <- f.artifacts.init(f.identity,InitUpload("other internal",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None,Vector.empty,None,None))
      _ <- f.artifacts.finish(f.identity,other.artifact.id)
      wrongArtifact <- h.app.run(navigate(s"/view/${other.artifact.id}/",Some(grant)))
      _ <- IO { assertEquals(wrongArtifact.status.code,200); assert(!wrongArtifact.headers.headers.exists(_.name == CIString("Set-Cookie"))) }
      agentToken = SecretCodec.token()
      _ <- IO.blocking(java.nio.file.Files.writeString(f.config.users.find(_.userType == "agent").get.tokens.head.hashFile,SecretCodec.sha256(agentToken)+"\n"))
      agent <- h.app.run(navigate(s"/view/$id/",Some("manure-dev="+agentToken)))
      _ <- IO { assertEquals(agent.status.code,401); assert(!agent.headers.headers.exists(_.name == CIString("Set-Cookie"))) }
      logout <- h.app.run(command(wire.Command.Logout(),None,Some("http://127.0.0.1:47329")).putHeaders(Header.Raw(CIString("Cookie"),session)))
      _ <- IO(assertEquals(logout.status.code,200))
      replay <- h.app.run(command(wire.Command.Whoami(),None).putHeaders(Header.Raw(CIString("Cookie"),session)))
      _ <- IO(assertEquals(replay.status.code,401))
      revoked <- h.app.run(request(Method.GET,s"/view/$id/nested/secret.md").putHeaders(Header.Raw(CIString("Cookie"),grant)))
      _ <- IO(assertEquals(revoked.status.code,401))
    yield ()
  }}
  test("bounded body, duplicate JSON and framing fail before initialization effects") { run { (f,h) => for
    dup <- h.app.run(command(wire.Command.Version(),None).withEntity("{\"apiVersion\":\"1.0.0\",\"apiVersion\":\"1.0.0\"}").putHeaders(Header.Raw(CIString("Content-Type"),"application/json")))
    _ <- IO(assertEquals(dup.status.code,400))
    large <- h.app.run(command(wire.Command.Version(),None).withEntity("x"*(f.config.limits.maxRequestBodyBytes+1)).putHeaders(Header.Raw(CIString("Content-Type"),"application/json")))
    _ <- IO(assertEquals(large.status.code,413))
    framing <- h.app.run(command(wire.Command.Version(),None).putHeaders(Header.Raw(CIString("Transfer-Encoding"),"chunked")))
    _ <- IO(assertEquals(framing.status.code,400))
    rows <- f.metadata.transaction(_.artifacts(None,100))
    _ <- IO(assertEquals(rows.size,0))
  yield () }}
  test("raw chunks/download byte ranges stream current contract and no secret in manifests") { run { (f,h) =>
    val bytes = Exact.utf8("0123456789")
    for
      initialized <- f.artifacts.init(f.identity,InitUpload("range",ArtifactKind.File,Visibility.Public,Vector(ManifestEntry("a+b.txt",false,bytes.length,SecretCodec.sha256(bytes))),None,Vector.empty,None,None))
      id = initialized.artifact.id
      put <- h.app.run(request(Method.PUT,s"/api/current/artifacts/$id/chunks?path=a%2Bb.txt&offset=0",Some(f.token))
        .withEntity(bytes).putHeaders(Header.Raw(CIString("X-Chunk-SHA256"),SecretCodec.sha256(bytes))))
      _ <- IO(assertEquals(put.status.code,200))
      receipt <- put.as[String].map(s => CurrentWire.decode(wire.ChunkReceipt.codecJson,CurrentWire.parse(s)))
      _ <- IO(assertEquals(receipt.receivedBytes,10L))
      _ <- f.artifacts.finish(f.identity,id)
      fetched <- h.app.run(request(Method.GET,s"/api/current/artifacts/$id/files/a+b.txt/content").putHeaders(Header.Raw(CIString("Range"),"bytes=2-4")))
      content <- fetched.body.compile.to(Array)
      _ <- IO { assertEquals(fetched.status.code,206); assertEquals(Exact.string(content),"234"); assert(fetched.headers.headers.exists(x => x.name == CIString("Content-Range") && x.value == "bytes 2-4/10")) }
      bad <- h.app.run(request(Method.GET,s"/api/current/artifacts/$id/files/a+b.txt/content").putHeaders(Header.Raw(CIString("Range"),"bytes=99-")))
      _ <- IO(assertEquals(bad.status.code,416))
      invalid <- h.app.run(request(Method.GET,s"/api/current/artifacts/$id/files/%ff/content"))
      _ <- IO(assertEquals(invalid.status.code,400))
    yield ()
  }}
  test("content hosting preserves user styles, inline scripts, no API and security headers") { run { (f,h) =>
    val bytes = Exact.utf8("user css")
    for
      a <- f.artifacts.init(f.identity,InitUpload("site",ArtifactKind.Directory,Visibility.Public,Vector(ManifestEntry("styles.css",false,bytes.length,SecretCodec.sha256(bytes))),None,Vector.empty,None,None))
      _ <- f.artifacts.putChunk(f.identity,a.artifact.id,"styles.css",0,bytes,SecretCodec.sha256(bytes))
      _ <- f.artifacts.finish(f.identity,a.artifact.id)
      response <- h.app.run(request(Method.GET,s"/view/${a.artifact.id}/styles.css"))
      data <- response.as[String]
      _ <- IO {
        assertEquals(data,"user css"); assertEquals(response.status.code,200)
        def header(name: String) = response.headers.headers.find(_.name == CIString(name)).map(_.value)
        val policy = header("Content-Security-Policy").getOrElse("")
        Vector("frame-ancestors 'none'","base-uri 'none'","form-action 'self'").foreach(directive => assert(policy.contains(directive),policy))
        assert(!policy.contains("sandbox"),policy)
        assertEquals(header("Cache-Control"),Some("no-store"))
        assertEquals(header("X-Content-Type-Options"),Some("nosniff"))
        assertEquals(header("Referrer-Policy"),Some("no-referrer"))
        assertEquals(header("Cross-Origin-Resource-Policy"),Some("same-origin"))
        assertEquals(header("Cross-Origin-Opener-Policy"),Some("same-origin"))
        assertEquals(header("Origin-Agent-Cluster"),Some("?1"))
        assertEquals(header("Access-Control-Allow-Origin"),None)
      }
      api <- h.app.run(request(Method.POST,s"/view/${a.artifact.id}/api/current",Some(f.token)))
      _ <- IO(assertEquals(api.status.code,404))
    yield ()
  }}
  test("reserved path prefixes never become user content: upload init refuses them as invalid-path") { run { (f,h) =>
    val digest = SecretCodec.sha256(Exact.utf8("x"))
    Vector("__manure/x.txt","api/y.txt","__manure","api").traverse_ { path =>
      h.app.run(command(wire.Command.InitUpload("reserved",wire.ArtifactKind.Directory,wire.Visibility.Internal,None,
        List(wire.ManifestEntry.File(path,1L,digest)),Nil,None,None),Some(f.token))).flatMap(r => r.as[String].map { text =>
        assertEquals(r.status.code,400,path)
        assertEquals(CurrentWire.decode(wire.ServerEnvelope.codecJson,CurrentWire.parse(text)).result.asInstanceOf[wire.Result.Error].failure.code,wire.ErrorCode.InvalidPath,path)
      })
    }
  }}
  test("content form redirects have exactly zero framed body bytes and preserve cookie and location effects") { run { (f,h) =>
    def form(id: String,action: String,value: String,cookie: Option[String] = None): Request[IO] =
      val r=request(Method.POST,s"/view/$id/__manure/$action",None,Some("http://127.0.0.1:47329")).withEntity(value)
        .putHeaders(Header.Raw(CIString("Content-Type"),"application/x-www-form-urlencoded"))
      cookie.fold(r)(v => r.putHeaders(Header.Raw(CIString("Cookie"),v)))
    def emptyRedirect(response: org.http4s.Response[IO]): IO[String] = response.body.compile.to(Array).map { bytes =>
      assertEquals(response.status.code,303)
      assertEquals(response.headers.headers.filter(_.name==CIString("Content-Length")).map(_.value),List("0"))
      assertEquals(bytes.toVector,Vector.empty)
      assert(response.headers.headers.exists(x => x.name==CIString("Location") && x.value.startsWith("/view/")))
      response.headers.headers.find(_.name==CIString("Set-Cookie")).get.value.split(";",2)(0)
    }
    for
      external <- f.artifacts.init(f.identity,InitUpload("external forms",ArtifactKind.Directory,Visibility.External,Vector.empty,None,Vector.empty,None,None))
      _ <- f.artifacts.finish(f.identity,external.artifact.id)
      unlocked <- h.app.run(form(external.artifact.id,"unlock","password="+external.externalPassword.get))
      cookie <- emptyRedirect(unlocked)
      _ <- IO(assert(cookie.startsWith("mgrant-dev-"+external.artifact.id+"=")))
      loggedOut <- h.app.run(form(external.artifact.id,"logout","",Some(cookie)))
      _ <- emptyRedirect(loggedOut)
      _ <- IO(assert(loggedOut.headers.headers.exists(x => x.name==CIString("Set-Cookie") && x.value.contains("Max-Age=0"))))
      internal <- f.artifacts.init(f.identity,InitUpload("internal forms",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None,Vector.empty,None,None))
      _ <- f.artifacts.finish(f.identity,internal.artifact.id)
      handoff <- f.artifacts.createGrant(f.identity,internal.artifact.id)
      redeemed <- h.app.run(form(internal.artifact.id,"grant","grant="+handoff))
      _ <- emptyRedirect(redeemed)
    yield ()
  }}
  test("locked external landing alone prompts; unknown assets and revoked file grants are never a 200 password form") { run { (f,h) =>
    val bytes=Exact.utf8("private artifact bytes")
    for
      initialized <- f.artifacts.init(f.identity,InitUpload("locked",ArtifactKind.File,Visibility.External,Vector(ManifestEntry("e.txt",false,bytes.length,SecretCodec.sha256(bytes))),None,Vector.empty,None,None))
      id=initialized.artifact.id
      _ <- f.artifacts.putChunk(f.identity,id,"e.txt",0,bytes,SecretCodec.sha256(bytes))
      _ <- f.artifacts.finish(f.identity,id)
      landing <- h.app.run(request(Method.GET,s"/view/$id/"))
      landingText <- landing.as[String]
      _ <- IO { assertEquals(landing.status.code,200);assert(landingText.contains("password")) }
      missing <- h.app.run(request(Method.GET,s"/view/$id/nope.js"))
      missingText <- missing.as[String]
      _ <- IO { assertEquals(missing.status.code,404);assert(!missingText.contains("<html")) }
      builtin=app(f,_.copy(unlockShellDir=None))
      _ <- Vector("unlock.js","styles.css","nope.js").traverse_ { name =>
        builtin.app.run(request(Method.GET,s"/view/$id/$name")).flatMap { response => response.as[String].map { body =>
          assertEquals(response.status.code,404);assert(!body.contains("<html"))
        }}
      }
      grant <- f.artifacts.unlock(id,initialized.externalPassword.get)
      cookie="mgrant-dev-"+id+"="+grant._1
      accepted <- h.app.run(request(Method.GET,s"/view/$id/e.txt").putHeaders(Header.Raw(CIString("Cookie"),cookie)))
      acceptedBytes <- accepted.body.compile.to(Array)
      _ <- IO { assertEquals(accepted.status.code,200);assertEquals(acceptedBytes.toVector,bytes.toVector) }
      _ <- f.artifacts.rotate(f.other,id)
      revoked <- h.app.run(request(Method.GET,s"/view/$id/e.txt").putHeaders(Header.Raw(CIString("Cookie"),cookie)))
      revokedText <- revoked.as[String]
      _ <- IO { assertEquals(revoked.status.code,404);assert(!revokedText.contains("<html"));assert(!revokedText.contains("private artifact bytes")) }
    yield ()
  }}
  // Regression: document-navigation preflight must not bypass the external unlock handler.
  test("locked external document navigation retains packaged and builtin password pages and missing-path controls") { run { (f,h) =>
    def navigate(path: String): Request[IO] = request(Method.GET,path).putHeaders(
      Header.Raw(CIString("Sec-Fetch-Mode"),"navigate"),Header.Raw(CIString("Sec-Fetch-Dest"),"document"))
    for
      a <- f.artifacts.init(f.identity,InitUpload("external navigation",ArtifactKind.Directory,Visibility.External,Vector.empty,None,Vector.empty,None,None))
      id = a.artifact.id
      _ <- f.artifacts.finish(f.identity,id)
      _ <- Vector(h,app(f,_.copy(unlockShellDir=None))).zipWithIndex.traverse_ { (handler,index) =>
        for
          _ <- Vector(s"/view/$id/",s"/view/$id/__manure/password").traverse_ { path =>
            handler.app.run(navigate(path)).flatMap { response => response.as[String].map { html =>
              assertEquals(response.status.code,200)
              assert(html.contains("<html")); assert(html.contains("password"))
              assert(response.headers.headers.exists(x => x.name == CIString("Content-Type") && x.value.startsWith("text/html")))
              assert(!response.headers.headers.exists(_.name == CIString("Set-Cookie")))
            }}
          }
          bare <- handler.app.run(navigate(s"/view/$id"))
          _ <- IO { assertEquals(bare.status.code,303); assert(bare.headers.headers.exists(x => x.name == CIString("Location") && x.value == s"/view/$id/")) }
          _ <- Vector("unlock.js","styles.css").traverse_ { name =>
            handler.app.run(navigate(s"/view/$id/$name")).flatMap { response => IO(assertEquals(response.status.code,if index == 0 then 200 else 404)) }
          }
          _ <- Vector("missing.txt","nested/","__manure/raw/missing.txt").traverse_ { name =>
            handler.app.run(navigate(s"/view/$id/$name")).flatMap { response => response.as[String].map { body =>
              assertEquals(response.status.code,if name.startsWith("__manure/raw/") then 401 else 404)
              assert(!body.contains("<html")); assert(!response.headers.headers.exists(_.name == CIString("Set-Cookie")))
            }}
          }
        yield ()
      }
    yield ()
  }}
  test("metadata-only management retrieval filters ready/expiry and excludes payload secrets") { run { (f,h) =>
    val bytes = Exact.utf8("secret payload body no index")
    for
      a <- f.artifacts.init(f.identity,InitUpload("Purple hayneedle",ArtifactKind.File,Visibility.Public,Vector(ManifestEntry("hayneedle.txt",false,bytes.length,SecretCodec.sha256(bytes))),None,Vector.empty,None,None))
      _ <- f.artifacts.putChunk(f.identity,a.artifact.id,"hayneedle.txt",0,bytes,SecretCodec.sha256(bytes))
      _ <- f.artifacts.finish(f.identity,a.artifact.id)
      query = wire.SearchQuery("hayneedle",wire.SearchMode.Lexical,wire.SearchFilter(None,None,None,Nil,None,None),20,None)
      unauthorized <- h.app.run(command(wire.Command.Search(query),None))
      _ <- IO(assertEquals(unauthorized.status.code,401))
      response <- h.app.run(command(wire.Command.Search(query),Some(f.token)))
      result <- response.as[String].map(s => CurrentWire.decode(wire.ServerEnvelope.codecJson,CurrentWire.parse(s)))
      _ <- IO { assertEquals(response.status.code,200); assertEquals(result.result.asInstanceOf[wire.Result.SearchResults].page.hits.map(_.artifact.artifactId),List(a.artifact.id)) }
      missing <- h.app.run(command(wire.Command.Search(query.copy(query="secret")),Some(f.token)))
      absent <- missing.as[String].map(s => CurrentWire.decode(wire.ServerEnvelope.codecJson,CurrentWire.parse(s)))
      _ <- IO(assertEquals(absent.result.asInstanceOf[wire.Result.SearchResults].page.hits,Nil))
      lexicalOnly <- h.app.run(command(wire.Command.Search(query.copy(mode=wire.SearchMode.Semantic)),Some(f.token)))
      refused <- lexicalOnly.as[String].map(s => CurrentWire.decode(wire.ServerEnvelope.codecJson,CurrentWire.parse(s)))
      _ <- IO {
        assertEquals(lexicalOnly.status.code,503)
        assertEquals(refused.result,wire.Result.Error(wire.Failure(wire.ErrorCode.SearchUnavailable,UnavailableReason.NotConfigured.text,None)))
      }
    yield ()
  }}

  test("current HTTP init/catalogue/search roundtrip explicit metadata with closed validation and evidence") { run { (f,h) =>
    val tags=List("tagneedle"," release ","CASE")
    val host="hostneedle.例"
    val project="/projectneedle/𐀀"
    def result(response: org.http4s.Response[IO]): IO[wire.Result] = response.as[String].map(s => CurrentWire.decode(wire.ServerEnvelope.codecJson,CurrentWire.parse(s)).result)
    def search(q: wire.SearchQuery): IO[wire.SearchPage] = h.app.run(command(wire.Command.Search(q),Some(f.token))).flatMap(result).map(_.asInstanceOf[wire.Result.SearchResults].page)
    for
      response <- h.app.run(command(wire.Command.InitUpload("artifact",wire.ArtifactKind.Directory,wire.Visibility.Internal,None,Nil,tags,Some(host),Some(project)),Some(f.token)))
      initialized <- result(response)
      id=initialized.asInstanceOf[wire.Result.UploadInitialized].artifactId
      info <- h.app.run(command(wire.Command.GetArtifact(id),Some(f.token))).flatMap(result)
      artifact=info.asInstanceOf[wire.Result.ArtifactInfo].artifact
      _ <- IO { assertEquals(artifact.tags,tags); assertEquals(artifact.hostname,Some(host)); assertEquals(artifact.projectPath,Some(project)) }
      _ <- f.artifacts.finish(f.identity,artifact.artifactId)
      _ <- Vector(("tagneedle",wire.EvidenceField.Tag),(host,wire.EvidenceField.Hostname),(project,wire.EvidenceField.ProjectPath)).traverse_ { (text,field) =>
        search(wire.SearchQuery(text,wire.SearchMode.Lexical,wire.SearchFilter(None,None,None,tags,Some(host),Some(project)),1,None)).map { page =>
          assertEquals(page.total,1L,clue(text)); assertEquals(page.hits.map(_.artifact.artifactId),List(artifact.artifactId))
          assertEquals(page.hits.head.evidence.map(_.field),List(field))
          assertEquals(page.hits.head.artifact.tags,tags)
        }
      }
      _ <- Vector(wire.SearchFilter(None,None,None,List("case"),None,None),wire.SearchFilter(None,None,None,Nil,Some(host.toUpperCase(java.util.Locale.ROOT)),None),wire.SearchFilter(None,None,None,Nil,None,Some(project+"/"))).traverse_ { filter =>
        search(wire.SearchQuery("tagneedle",wire.SearchMode.Lexical,filter,1,None)).map(page => assertEquals(page.total,0L))
      }
      bad <- h.app.run(command(wire.Command.Search(wire.SearchQuery("tagneedle",wire.SearchMode.Lexical,wire.SearchFilter(None,None,None,List("\ufeff"),None,None),1,None)),Some(f.token)))
      _ <- IO(assertEquals(bad.status.code,400))
      listed <- h.app.run(command(wire.Command.ListArtifacts(wire.CatalogueQuery("PROJECTNEEDLE",false,None,None,wire.CatalogueSort.Name,wire.SortDirection.Asc,1,None,tags,Some(host),Some(project))),Some(f.token)))
      page <- result(listed)
      _ <- IO(assertEquals(page.asInstanceOf[wire.Result.Catalogue].page.artifacts.map(_.artifactId),List(artifact.artifactId)))
    yield ()
  }}

  // Specified: Behavioral-Active / Blackbox / Good Communication (owned PG + FS).
  test("Manure-owned preview and access shells share a mount-aware public favicon without changing artifact bytes") { run { (f,_) =>
    val source = java.nio.file.Path.of(sys.env("MANURE_SOURCE_ROOT"))
    val files = Vector("README.md" -> "# Preview", "empty" -> "", "site/index.html" -> "<title>Uploaded site</title>", "favicon.svg" -> "uploaded favicon")
    for
      a <- f.artifacts.init(f.identity,InitUpload("preview icons",ArtifactKind.Directory,Visibility.Public,
        files.map { (p,b) => ManifestEntry(p,false,Exact.utf8(b).length,SecretCodec.sha256(Exact.utf8(b))) } :+ ManifestEntry("nested",true,0,""),None,Vector.empty,None,None))
      _ <- files.filter(_._2.nonEmpty).traverse_ { (p,b) => f.artifacts.putChunk(f.identity,a.artifact.id,p,0,Exact.utf8(b),SecretCodec.sha256(Exact.utf8(b))) }
      _ <- f.artifacts.finish(f.identity,a.artifact.id)
      expected <- IO.blocking(java.nio.file.Files.readString(source.resolve("manure/web/dashboard/favicon.svg")))
      _ <- Vector("path","subdomain").traverse_ { mode =>
        val h = app(f,_.copy(viewerDir=Some(source.resolve("manure/web/viewer")),unlockShellDir=Some(source.resolve("manure/web/unlock")),contentMode=mode,contentSuffix="localhost"))
        val mount = if mode == "path" then s"/view/${a.artifact.id}" else ""
        def req(path: String) = request(Method.GET,mount + path).putHeaders(Header.Raw(CIString("Host"),if mode == "path" then "127.0.0.1:47329" else a.artifact.id + ".localhost:47329"))
        val icon = mount + "/__manure/viewer/favicon.svg"
        def checkShell(response: org.http4s.Response[IO]): IO[Unit] = response.as[String].map { html =>
          assert(html.contains("rel=\"icon\""),s"missing preview favicon in $mode shell")
          assert(html.contains("href=\"" + icon + "\""),s"incorrect preview favicon mount in $mode shell")
        }
        for
          _ <- Vector("/","/nested/","/__manure/view/README.md").traverse_ { path => h.app.run(req(path)).flatMap(checkShell) }
          disabled = app(f,_.copy(viewerDir=None,contentMode=mode,contentSuffix="localhost"))
          _ <- disabled.app.run(req("/")).flatMap(checkShell)
          response <- h.app.run(req("/__manure/viewer/favicon.svg"))
          svg <- response.as[String]
          _ <- IO {
            assertEquals(response.status.code,200)
            assertEquals(svg,expected)
            assertEquals(response.headers.headers.find(_.name == CIString("Content-Type")).map(_.value),Some("image/svg+xml"))
          }
          _ <- Vector("/site/" -> "<title>Uploaded site</title>","/favicon.svg" -> "uploaded favicon","/README.md" -> "# Preview").traverse_ { (path,expected) =>
            h.app.run(req(path)).flatMap(_.as[String]).map(body => assertEquals(body,expected))
          }
        yield ()
      }
      _ <- f.artifacts.patch(f.identity,a.artifact.id,ArtifactPatch(None,Some(Visibility.External),TtlPatch.Unchanged))
      _ <- Vector("path","subdomain").traverse_ { mode =>
        val mount = if mode == "path" then s"/view/${a.artifact.id}" else ""
        def req(path: String) = request(Method.GET,mount + path).putHeaders(Header.Raw(CIString("Host"),if mode == "path" then "127.0.0.1:47329" else a.artifact.id + ".localhost:47329"))
        val icon = mount + "/__manure/viewer/favicon.svg"
        val h = app(f,_.copy(contentMode=mode,contentSuffix="localhost",unlockShellDir=Some(source.resolve("manure/web/unlock"))))
        for
          _ <- Vector(h,app(f,_.copy(contentMode=mode,contentSuffix="localhost",unlockShellDir=None,viewerDir=None,dashboardDir=None))).traverse_ { server =>
            for
              shell <- server.app.run(req("/"))
              html <- shell.as[String]
              _ <- IO(assert(html.contains("href=\"" + icon + "\"")))
              response <- server.app.run(req("/__manure/viewer/favicon.svg"))
              svg <- response.as[String]
              _ <- IO { assertEquals(response.status.code,200); assertEquals(svg,expected) }
              raw <- server.app.run(req("/__manure/raw/README.md"))
              _ <- IO(assert(raw.status.code != 200,"favicon access must not grant artifact access"))
            yield ()
          }
        yield ()
      }
    yield ()
  }}
  test("viewer shells show the original artifact creation time across preview routes and hosting modes") { run { (f,_) =>
    val source = java.nio.file.Path.of(sys.env("MANURE_SOURCE_ROOT"))
    val files = Vector("README.md","nested/readme.md")
    for
      a <- f.artifacts.init(f.identity,InitUpload("timestamp",ArtifactKind.Directory,Visibility.Public,
        files.map(name => ManifestEntry(name,false,0,SecretCodec.sha256(Array.emptyByteArray))),None,Vector.empty,None,None))
      _ <- IO { f.clock.now += 3600 }
      _ <- f.artifacts.finish(f.identity,a.artifact.id)
      _ <- Vector("path","subdomain").traverse_ { mode =>
        val h = app(f,_.copy(viewerDir=Some(source.resolve("manure/web/viewer")),contentMode=mode,contentSuffix="localhost"))
        val mount = if mode == "path" then s"/view/${a.artifact.id}" else ""
        def req(path: String) = request(Method.GET,mount + path).putHeaders(Header.Raw(CIString("Host"),
          if mode == "path" then "127.0.0.1:47329" else a.artifact.id + ".localhost:47329"))
        Vector("/","/nested/","/__manure/view/README.md").traverse_ { path =>
          h.app.run(req(path)).flatMap { response => response.as[String].map { html =>
            assertEquals(response.status.code,200)
            assert(html.contains("uploaded <time"),path)
            assert(html.contains("datetime=\"" + a.artifact.createdAt + "\" title=\"" + a.artifact.createdAt + "\">" + a.artifact.createdAt + "</time>"),path)
            assert(!html.contains("__MANURE_CREATED_AT__"))
            assert(!html.contains(Exact.displayTime(f.clock.now)))
          }}
        }
      }
    yield ()
  }}
  test("viewer negotiation, escaped shell, raw ranges, exact authorized assets and disabled fallback") { run { (f,_) =>
    val bytes = Exact.utf8("# viewer bytes")
    val name = "a&\"<馬>.md"
    val encoded = "a%26%22%3C%E9%A6%AC%3E.md"
    def hdr(name: String,value: String) = Header.Raw(CIString(name),value)
    def value(r: org.http4s.Response[IO],name: String) = r.headers.headers.find(_.name == CIString(name)).map(_.value).getOrElse("")
    for
      dir <- IO.blocking {
        val dir = java.nio.file.Files.createDirectory(f.config.dataDir.getParent.resolve("viewer"))
        java.nio.file.Files.writeString(dir.resolve("index.html"),"""<meta id="manure-viewer" data-path="__MANURE_PATH__" data-raw-url="__MANURE_RAW_URL__" data-download-url="__MANURE_DOWNLOAD_URL__" data-kind="__MANURE_KIND__"><script src="__MANURE_ASSET_BASE__/viewer.js"></script>""")
        Vector("viewer.js","styles.css","graphviz-worker.js","pdf.worker.min.mjs","pdf.renderer.min.mjs").foreach(n => java.nio.file.Files.writeString(dir.resolve(n),"asset:" + n))
        dir
      }
      h = app(f,_.copy(viewerDir=Some(dir)))
      a <- f.artifacts.init(f.identity,InitUpload("viewer",ArtifactKind.File,Visibility.Public,Vector(ManifestEntry(name,false,bytes.length,SecretCodec.sha256(bytes))),None,Vector.empty,None,None))
      id = a.artifact.id
      base = s"/view/$id"
      _ <- f.artifacts.putChunk(f.identity,id,name,0,bytes,SecretCodec.sha256(bytes))
      _ <- f.artifacts.finish(f.identity,id)
      raw <- h.app.run(request(Method.GET,base + "/"))
      rawBody <- raw.as[String]
      _ <- IO { assertEquals(rawBody,Exact.string(bytes)); assertEquals(value(raw,"Vary"),"Accept") }
      _ <- Vector("*/*","application/json","text/html;q=0","application/xhtml+xml").traverse_ { accept =>
        h.app.run(request(Method.GET,base + "/").putHeaders(hdr("Accept",accept))).flatMap(r => r.as[String].flatMap(b => IO(assertEquals(b,Exact.string(bytes)))))
      }
      shell <- h.app.run(request(Method.GET,base + "/").putHeaders(hdr("Accept","text/html")))
      html <- shell.as[String]
      _ <- IO {
        assertEquals(shell.status.code,200)
        assert(html.contains("a&amp;&quot;&lt;馬&gt;.md"))
        assert(html.contains(base + "/__manure/raw/" + encoded))
        assert(html.contains("src=\"" + base + "/__manure/viewer/viewer.js\""))
        assert(value(shell,"Content-Security-Policy").contains("script-src 'self' 'wasm-unsafe-eval'"))
        // Regression: Chromium blocks Mermaid's generated inline SVG styles without this allowance.
        val policy = value(shell,"Content-Security-Policy")
        assert(policy.contains("style-src 'self' 'unsafe-inline'"))
        assertEquals(policy.split(";").map(_.trim).find(_.startsWith("script-src ")),Some("script-src 'self' 'wasm-unsafe-eval'"))
        assert(policy.contains("object-src 'none'"))
        assert(policy.contains("frame-src 'none'"))
      }
      _ <- Vector(base + "/",base + "/__manure/raw/" + encoded,base + "/__manure/view/" + encoded,base + "/__manure/files/" + encoded + "/content").traverse_ { path =>
        h.app.run(request(Method.GET,path).putHeaders(hdr("Accept","text/html"),hdr("Range","bytes=2-7"))).flatMap { r =>
          r.as[String].flatMap(b => IO { assertEquals(r.status.code,206); assertEquals(b,"viewer") })
        }
      }
      direct <- h.app.run(request(Method.GET,base + "/" + encoded).putHeaders(hdr("Accept","text/html")))
      directBody <- direct.as[String]
      _ <- IO(assertEquals(directBody,Exact.string(bytes)))
      asset <- h.app.run(request(Method.GET,base + "/__manure/viewer/pdf.renderer.min.mjs"))
      assetBody <- asset.as[String]
      _ <- IO(assertEquals(assetBody,"asset:pdf.renderer.min.mjs"))
      _ <- Vector("index.html","../index.html","unknown.js","viewer.js/extra").traverse_ { path =>
        h.app.run(request(Method.GET,base + "/__manure/viewer/" + path)).flatMap(r => IO(assertEquals(r.status.code,404)))
      }
      missing <- h.app.run(request(Method.GET,base + "/__manure/view/no.md"))
      _ <- IO(assertEquals(missing.status.code,404))
      disabled <- app(f,_.copy(viewerDir=None)).app.run(request(Method.GET,base + "/").putHeaders(hdr("Accept","text/html")))
      disabledBody <- disabled.as[String]
      _ <- IO(assertEquals(disabledBody,Exact.string(bytes)))
      absent <- app(f,_.copy(viewerDir=Some(dir.resolve("missing")))).app.run(request(Method.GET,base + "/").putHeaders(hdr("Accept","text/html")))
      _ <- IO(assertEquals(absent.status.code,404))
      site <- f.artifacts.init(f.identity,InitUpload("directory",ArtifactKind.Directory,Visibility.Public,
        Vector("index.html","note.md").map(n => ManifestEntry(n,false,bytes.length,SecretCodec.sha256(bytes))),None,Vector.empty,None,None))
      _ <- Vector("index.html","note.md").traverse_(n => f.artifacts.putChunk(f.identity,site.artifact.id,n,0,bytes,SecretCodec.sha256(bytes)))
      _ <- f.artifacts.finish(f.identity,site.artifact.id)
      _ <- Vector("/","/note.md").traverse_ { suffix =>
        h.app.run(request(Method.GET,s"/view/${site.artifact.id}" + suffix).putHeaders(hdr("Accept","text/html"))).flatMap(r => r.as[String].flatMap(b => IO(assertEquals(b,Exact.string(bytes)))))
      }
      explicit <- h.app.run(request(Method.GET,s"/view/${site.artifact.id}/__manure/view/note.md"))
      explicitBody <- explicit.as[String]
      _ <- IO { assertEquals(explicit.status.code,200); assert(explicitBody.contains("data-kind=\"markdown\"")) }
      unsupported <- h.app.run(request(Method.GET,s"/view/${site.artifact.id}/__manure/view/index.html"))
      _ <- IO(assertEquals(unsupported.status.code,404))
      _ <- IO.blocking {
        val oversized = new java.io.RandomAccessFile(dir.resolve("styles.css").toFile,"rw")
        try oversized.setLength(16777217L) finally oversized.close()
      }
      oversized <- h.app.run(request(Method.GET,base + "/__manure/viewer/styles.css"))
      _ <- IO(assertEquals(oversized.status.code,404))
      sub = app(f,_.copy(viewerDir=Some(dir),contentMode="subdomain",contentSuffix="localhost"))
      subShell <- sub.app.run(request(Method.GET,"/").putHeaders(hdr("Host",id + ".localhost:47329"),hdr("Accept","text/html;q=0.8")))
      subHtml <- subShell.as[String]
      _ <- IO { assertEquals(subShell.status.code,200); assert(subHtml.contains("src=\"/__manure/viewer/viewer.js\"")); assert(!subHtml.contains(base)) }
      _ <- f.artifacts.patch(f.identity,id,ArtifactPatch(None,Some(Visibility.External),TtlPatch.Unchanged))
      _ <- Vector("/__manure/view/" + encoded,"/__manure/viewer/viewer.js","/__manure/raw/" + encoded).traverse_ { path =>
        h.app.run(request(Method.GET,base + path)).flatMap { r => r.as[String].flatMap(b => IO { assert(r.status.code != 200); assert(!b.contains("<meta")); assert(!b.contains("asset:")) }) }
      }
      _ <- f.artifacts.delete(f.identity,id)
      deleted <- h.app.run(request(Method.GET,base + "/").putHeaders(hdr("Accept","text/html")))
      _ <- IO(assertEquals(deleted.status.code,404))
    yield ()
  }}

  // Specified (UX-M4): the listing is styled only by the content shell (unlock_shell_dir: the shared design system,
  // content.css, chrome.js), under a policy that admits nothing else of the content origin, which also serves uploaded
  // files. The shell does not depend on the dashboard or the viewer being enabled; without a shell the page is bare.
  test("directory listing uses the content shell under a reserved-asset CSP, independent of dashboard and viewer") { run { (f,_) =>
    val files = Vector("docs/notes.txt" -> "plain", "docs/a\"<b>.py" -> "print(1)")
    val shellAssets = Vector("/__manure/shell/ui/tokens.css","/__manure/shell/ui/components.css","/__manure/shell/content.css")
    def value(r: org.http4s.Response[IO],name: String) = r.headers.headers.find(_.name == CIString(name)).map(_.value).getOrElse("")
    for
      shell <- IO.blocking {
        val directory = f.rootPath.resolve("content-shell")
        java.nio.file.Files.createDirectories(directory.resolve("ui"))
        Vector("ui/tokens.css","ui/components.css","content.css").foreach(name => java.nio.file.Files.writeString(directory.resolve(name),":root {}"))
        java.nio.file.Files.writeString(directory.resolve("chrome.js"),"export {};")
        java.nio.file.Files.writeString(directory.resolve("ui/README.md"),"not a served asset")
        directory
      }
      a <- f.artifacts.init(f.identity,InitUpload("listing",ArtifactKind.Directory,Visibility.Public,
        files.map { (p,b) => ManifestEntry(p,false,Exact.utf8(b).length,SecretCodec.sha256(Exact.utf8(b))) },None,Vector.empty,None,None))
      _ <- files.traverse_ { (p,b) => f.artifacts.putChunk(f.identity,a.artifact.id,p,0,Exact.utf8(b),SecretCodec.sha256(Exact.utf8(b))) }
      _ <- f.artifacts.finish(f.identity,a.artifact.id)
      _ <- Vector("path","subdomain").traverse_ { mode =>
        // Neither the dashboard nor the viewer is enabled: the listing still gets its whole presentation.
        val h = app(f,_.copy(viewerDir=None,dashboardDir=None,unlockShellDir=Some(shell),contentMode=mode,contentSuffix="localhost"))
        val bare = app(f,_.copy(unlockShellDir=None,contentMode=mode,contentSuffix="localhost"))
        val mount = if mode == "path" then s"/view/${a.artifact.id}" else ""
        val host = if mode == "path" then "127.0.0.1:47329" else a.artifact.id + ".localhost:47329"
        def req(path: String) = request(Method.GET,mount + path).putHeaders(Header.Raw(CIString("Host"),host))
        val reserved = "http://" + host + mount + "/__manure/"
        for
          listing <- h.app.run(req("/docs/"))
          html <- listing.as[String]
          _ <- IO {
            assertEquals(listing.status.code,200)
            shellAssets.foreach(css => assert(html.contains("<link rel=\"stylesheet\" href=\"" + mount + css + "\">"),s"$mode listing lacks $css"))
            assert(html.contains("<script type=\"module\" src=\"" + mount + "/__manure/shell/chrome.js\"></script>"))
            assert(!html.contains("/__manure/viewer/styles.css") && !html.contains("/__manure/viewer/viewer.js"),"no viewer assets without a README")
            val policy = value(listing,"Content-Security-Policy").split(";").map(_.trim).toVector
            assertEquals(policy.find(_.startsWith("default-src ")),Some("default-src 'none'"))
            assertEquals(policy.find(_.startsWith("style-src ")),Some(s"style-src ${reserved}shell/"))
            assertEquals(policy.find(_.startsWith("script-src ")),Some(s"script-src ${reserved}shell/"))
            assert(!policy.exists(d => d.contains("'self'") || d.contains("unsafe")),policy)
            assert(html.contains("a&quot;&lt;b&gt;.py") && !html.contains("a\"<b>.py"),"listing names are escaped")
          }
          _ <- (shellAssets :+ "/__manure/shell/chrome.js").traverse_ { asset => h.app.run(req(asset)).flatMap(r => IO(assertEquals(r.status.code,200,asset))) }
          hidden <- h.app.run(req("/__manure/shell/ui/README.md"))
          _ <- IO(assertEquals(hidden.status.code,404))
          plain <- bare.app.run(req("/docs/"))
          plainHtml <- plain.as[String]
          missing <- bare.app.run(req("/__manure/shell/content.css"))
          _ <- IO {
            assertEquals(plain.status.code,200)
            assert(plainHtml.contains("aria-label=\"Directory contents\""))
            assert(!plainHtml.contains("/__manure/shell/") && !plainHtml.contains("<script"),"without a shell the listing references no shell asset")
            assert(!value(plain,"Content-Security-Policy").contains("script-src"))
            assertEquals(missing.status.code,404)
          }
        yield ()
      }
    yield ()
  }}
  // Regression (UX-M4): source files downloaded instead of previewing; archives stay downloads behind an explicit card.
  // Specified: every type except HTML has a viewer page. Well-known names are text, media get a player, and a type
  // that is not listed is `unknown` (shown as text when its content is text, otherwise a download card).
  test("file artifacts negotiate a viewer by type: text, media, archive card, unknown; HTML stays raw bytes") { run { (f,_) =>
    val viewer = Some(java.nio.file.Path.of(sys.env("MANURE_SOURCE_ROOT"),"manure/web/viewer"))
    val h = app(f,_.copy(viewerDir=viewer))
    Vector("summarise.py" -> Some("text"),"fix.diff" -> Some("text"),"Main.kt" -> Some("text"),"Makefile" -> Some("text"),"Dockerfile" -> Some("text"),
      "LICENSE" -> Some("text"),".gitignore" -> Some("text"),"flake.lock" -> Some("text"),"demo.webm" -> Some("video"),"clip.MP4" -> Some("video"),
      "tone.wav" -> Some("audio"),"bundle.zip" -> Some("archive"),"model.safetensors" -> Some("unknown"),"run-20261120" -> Some("unknown"),
      "BUILD" -> Some("unknown"),"html" -> Some("unknown"),"page.html." -> Some("unknown"),"page.html" -> None,"PAGE.HTM" -> None).traverse_ { (name,kind) =>
      val bytes = Exact.utf8("payload of " + name)
      for
        a <- f.artifacts.init(f.identity,InitUpload(name,ArtifactKind.File,Visibility.Public,Vector(ManifestEntry(name,false,bytes.length,SecretCodec.sha256(bytes))),None,Vector.empty,None,None))
        _ <- f.artifacts.putChunk(f.identity,a.artifact.id,name,0,bytes,SecretCodec.sha256(bytes))
        _ <- f.artifacts.finish(f.identity,a.artifact.id)
        response <- h.app.run(request(Method.GET,s"/view/${a.artifact.id}/").putHeaders(Header.Raw(CIString("Accept"),"text/html")))
        body <- response.as[String]
        unshelled <- app(f,_.copy(viewerDir=viewer,unlockShellDir=None)).app.run(request(Method.GET,s"/view/${a.artifact.id}/").putHeaders(Header.Raw(CIString("Accept"),"text/html")))
        unshelledBody <- unshelled.as[String]
        _ <- IO {
          assertEquals(response.status.code,200)
          kind match
            case Some(value) =>
              assert(body.contains("data-kind=\"" + value + "\""),name)
              assert(body.contains("href=\"/view/" + a.artifact.id + "/__manure/shell/content.css\""),"viewer links the content shell")
              assert(unshelledBody.contains("data-kind=\"" + value + "\"") && !unshelledBody.contains("__manure/shell"),"no shell links without a shell directory")
            case None => assertEquals(body,Exact.string(bytes))
        }
        // Clients that do not ask for HTML, and byte ranges, always get the stored bytes.
        direct <- h.app.run(request(Method.GET,s"/view/${a.artifact.id}/"))
        directBody <- direct.as[String]
        ranged <- h.app.run(request(Method.GET,s"/view/${a.artifact.id}/").putHeaders(Header.Raw(CIString("Accept"),"text/html"),Header.Raw(CIString("Range"),"bytes=0-6")))
        rangedBody <- ranged.as[String]
        _ <- IO {
          assertEquals(directBody,Exact.string(bytes),name)
          assertEquals(ranged.status.code,206,name)
          assertEquals(rangedBody,"payload",name)
        }
      yield ()
    }
  }}
  // Specified: the viewer page may load media of its own origin (audio and video players) and nothing else new.
  test("the viewer policy admits same-origin media; media files have media types on their raw URL") { run { (f,_) =>
    val viewer = Some(java.nio.file.Path.of(sys.env("MANURE_SOURCE_ROOT"),"manure/web/viewer"))
    val h = app(f,_.copy(viewerDir=viewer))
    val files = Vector("demo.webm" -> "video/webm","clip.mp4" -> "video/mp4","take.mov" -> "video/quicktime","old.ogv" -> "video/ogg","song.mp3" -> "audio/mpeg",
      "tone.wav" -> "audio/wav","voice.ogg" -> "audio/ogg","voice.opus" -> "audio/ogg","track.m4a" -> "audio/mp4","master.flac" -> "audio/flac","raw.aac" -> "audio/aac")
    def value(r: org.http4s.Response[IO],name: String) = r.headers.headers.find(_.name == CIString(name)).map(_.value).getOrElse("")
    for
      a <- f.artifacts.init(f.identity,InitUpload("media",ArtifactKind.Directory,Visibility.Public,
        files.map((path,_) => ManifestEntry(path,false,Exact.utf8(path).length,SecretCodec.sha256(Exact.utf8(path)))),None,Vector.empty,None,None))
      _ <- files.traverse_((path,_) => f.artifacts.putChunk(f.identity,a.artifact.id,path,0,Exact.utf8(path),SecretCodec.sha256(Exact.utf8(path))))
      _ <- f.artifacts.finish(f.identity,a.artifact.id)
      _ <- files.traverse_ { (path,mime) =>
        for
          page <- h.app.run(request(Method.GET,s"/view/${a.artifact.id}/__manure/view/$path"))
          html <- page.as[String]
          bytes <- h.app.run(request(Method.GET,s"/view/${a.artifact.id}/__manure/raw/$path").putHeaders(Header.Raw(CIString("Range"),"bytes=2-4")))
          part <- bytes.as[String]
          _ <- IO {
            assertEquals(page.status.code,200,path)
            assert(html.contains("data-kind=\"" + mime.takeWhile(_ != '/') + "\""),path)
            val policy = value(page,"Content-Security-Policy").split(";").map(_.trim).toVector
            assertEquals(policy.find(_.startsWith("media-src ")),Some("media-src 'self'"),path)
            assertEquals(policy.find(_.startsWith("default-src ")),Some("default-src 'none'"),path)
            assertEquals(value(bytes,"Content-Type"),mime,path)
            assertEquals(bytes.status.code,206,"players seek with byte ranges")
            assertEquals(part,path.substring(2,5),path)
          }
        yield ()
      }
    yield ()
  }}
  // Regression: a text file inside a directory artifact was application/octet-stream on its own URL, so a browser
  // downloaded run.sh, fix.diff or values.yaml instead of showing it. Site assets and unknown types keep their type.
  test("files of text types are served as text/plain on their direct and raw URLs") { run { (f,h) =>
    val plain = "text/plain; charset=utf-8"
    val expected = Vector("run.sh" -> plain,"fix.diff" -> plain,"values.yaml" -> plain,"src/Main.scala" -> plain,"tool.py" -> plain,"notes.txt" -> plain,
      "build.log" -> plain,"table.csv" -> plain,"config.xml" -> plain,"data.json" -> "application/json","app.js" -> "application/javascript; charset=utf-8",
      "site.css" -> "text/css; charset=utf-8","page.html" -> "text/html; charset=utf-8","photo.png" -> "image/png","blob.bin" -> "application/octet-stream",
      "bundle.zip" -> "application/octet-stream","noextension" -> "application/octet-stream","Makefile" -> plain,"docker/Dockerfile" -> plain,
      "LICENSE" -> plain,".gitignore" -> plain,"flake.lock" -> plain,"demo.webm" -> "video/webm","tone.wav" -> "audio/wav",
      // Regression (review F5): the type was taken from the text after any dot of the path, so these were text/html.
      "html" -> "application/octet-stream","page.html." -> "application/octet-stream","dir.html/data" -> "application/octet-stream","dir.html/readme" -> plain)
    def contentType(r: org.http4s.Response[IO]) = r.headers.headers.find(_.name == CIString("Content-Type")).map(_.value)
    for
      a <- f.artifacts.init(f.identity,InitUpload("types",ArtifactKind.Directory,Visibility.Public,
        expected.map((path,_) => ManifestEntry(path,false,Exact.utf8(path).length,SecretCodec.sha256(Exact.utf8(path)))),None,Vector.empty,None,None))
      _ <- expected.traverse_((path,_) => f.artifacts.putChunk(f.identity,a.artifact.id,path,0,Exact.utf8(path),SecretCodec.sha256(Exact.utf8(path))))
      _ <- f.artifacts.finish(f.identity,a.artifact.id)
      _ <- expected.traverse_ { (path,mime) =>
        Vector(s"/view/${a.artifact.id}/$path",s"/view/${a.artifact.id}/__manure/raw/$path").traverse_ { url =>
          for
            response <- h.app.run(request(Method.GET,url).putHeaders(Header.Raw(CIString("Accept"),"text/html")))
            body <- response.as[String]
            _ <- IO {
              assertEquals(response.status.code,200,url)
              assertEquals(contentType(response),Some(mime),url)
              assertEquals(response.headers.headers.find(_.name == CIString("X-Content-Type-Options")).map(_.value),Some("nosniff"),url)
              assertEquals(body,path,"the bytes are the stored file")
            }
          yield ()
        }
      }
      download <- h.app.run(request(Method.GET,s"/view/${a.artifact.id}/__manure/files/run.sh/content"))
      _ <- IO(assertEquals(contentType(download),Some("application/octet-stream"),"attachment downloads stay opaque"))
    yield ()
  }}
  // Regression: directories without an index were inaccessible, including empty uploads.
  // Behavioral-Active / Blackbox / Good Communication (owned PostgreSQL + filesystem).
  test("no-index directories browse immediate children, nested and empty directories") { run { (f,h) =>
    for
      a <- f.artifacts.init(f.identity,InitUpload("directory",ArtifactKind.Directory,Visibility.Public,
        Vector(ManifestEntry("nested",true,0,""),ManifestEntry("empty",true,0,""),
          ManifestEntry("nested/leaf",true,0,""),ManifestEntry("a & <b>.md",false,0,SecretCodec.sha256(Array.emptyByteArray))),None,Vector.empty,None,None))
      _ <- f.artifacts.finish(f.identity,a.artifact.id)
      base = s"/view/${a.artifact.id}"
      root <- h.app.run(request(Method.GET,base + "/"))
      html <- root.as[String]
      _ <- IO {
        assertEquals(root.status.code,200)
        assert(html.contains("a &amp; &lt;b&gt;.md"))
        assert(html.contains(base + "/__manure/view/a%20%26%20%3Cb%3E.md"))
        assert(html.contains(base + "/nested/"))
        assert(!html.contains("nested/leaf"))
      }
      redirect <- h.app.run(request(Method.GET,base + "/nested"))
      _ <- IO(assertEquals(redirect.status.code,303))
      _ <- Vector("nested/","nested/leaf/","empty/").traverse_ { path =>
        h.app.run(request(Method.GET,base + "/" + path)).flatMap { r =>
          r.as[String].map { body => assertEquals(r.status.code,200); assert(body.contains("Parent directory")) }
        }
      }
      absent <- h.app.run(request(Method.GET,base + "/absent/"))
      _ <- IO(assertEquals(absent.status.code,404))
    yield ()
  }}
  test("directory README uses local Markdown preview; html then htm indices retain original bytes") { run { (f,_) =>
    val files = Vector("README.md" -> "# Read me", "site/index.htm" -> "htm site",
      "both/index.html" -> "html wins", "both/index.htm" -> "htm loses", "site/README.md" -> "not a preview",
      "nested/README.md" -> "# Nested")
    val h = app(f,_.copy(viewerDir=Some(java.nio.file.Path.of(sys.env("MANURE_SOURCE_ROOT"),"manure/web/viewer"))))
    for
      a <- f.artifacts.init(f.identity,InitUpload("<directory>",ArtifactKind.Directory,Visibility.Public,
        files.map { (p,b) => ManifestEntry(p,false,Exact.utf8(b).length,SecretCodec.sha256(Exact.utf8(b))) },None,Vector.empty,None,None))
      _ <- files.traverse_ { (p,b) => f.artifacts.putChunk(f.identity,a.artifact.id,p,0,Exact.utf8(b),SecretCodec.sha256(Exact.utf8(b))) }
      _ <- f.artifacts.finish(f.identity,a.artifact.id)
      base = s"/view/${a.artifact.id}"
      _ <- Vector("" -> "README.md", "nested/" -> "nested/README.md").traverse_ { (dir,readme) =>
        h.app.run(request(Method.GET,base + "/" + dir)).flatMap { r => r.as[String].map { html =>
          assertEquals(r.status.code,200)
          assert(html.contains("aria-label=\"Directory contents\""))
          assert(html.contains("data-kind=\"markdown\""))
          assert(html.contains("data-raw-url=\"" + base + "/__manure/raw/" + readme + "\""))
          assert(html.contains("&lt;directory&gt;"))
          assert(!html.contains("# Read me"),"README bytes are rendered by the existing local viewer, not inserted as HTML")
          assert(r.headers.headers.exists(x => x.name == CIString("Content-Security-Policy") && x.value.contains("frame-src 'none'")))
        }}
      }
      _ <- Vector("site/" -> "htm site","both/" -> "html wins").traverse_ { (dir,expected) =>
        h.app.run(request(Method.GET,base + "/" + dir)).flatMap(r => r.as[String].map(b => assertEquals(b,expected)))
      }
      raw <- h.app.run(request(Method.GET,base + "/README.md"))
      text <- raw.as[String]
      _ <- IO(assertEquals(text,"# Read me"))
      disabled <- app(f,_.copy(viewerDir=None)).app.run(request(Method.GET,base + "/"))
      html <- disabled.as[String]
      _ <- IO { assertEquals(disabled.status.code,200); assert(html.contains("Directory contents")); assert(!html.contains("data-kind")) }
      sub = app(f,_.copy(viewerDir=Some(java.nio.file.Path.of(sys.env("MANURE_SOURCE_ROOT"),"manure/web/viewer")),contentMode="subdomain",contentSuffix="localhost"))
      response <- sub.app.run(request(Method.GET,"/").putHeaders(Header.Raw(CIString("Host"),a.artifact.id+".localhost:47329")))
      subHtml <- response.as[String]
      _ <- IO { assertEquals(response.status.code,200); assert(subHtml.contains("href=\"/site/\"")); assert(subHtml.contains("data-raw-url=\"/__manure/raw/README.md\"")) }
      empty <- f.artifacts.init(f.identity,InitUpload("empty",ArtifactKind.Directory,Visibility.Public,Vector.empty,None,Vector.empty,None,None))
      _ <- f.artifacts.finish(f.identity,empty.artifact.id)
      emptyResponse <- h.app.run(request(Method.GET,s"/view/${empty.artifact.id}/"))
      emptyHtml <- emptyResponse.as[String]
      _ <- IO { assertEquals(emptyResponse.status.code,200); assert(emptyHtml.contains("Empty directory")) }
    yield ()
  }}
  // Regression: a lowercase readme.md was listed but not rendered.
  // Behavioral-Active / Blackbox / Good Communication (owned PG + filesystem).
  test("directory README matching is immediate, case-insensitive and deterministically preferred") { run { (f,_) =>
    val files = Vector("lower/readme.md", "upper/README.md", "upper/readme.md", "upper/ReadMe.md",
      "prefer-lower/readme.md", "prefer-lower/ReadMe.md", "mixed/Readme.MD", "mixed/ReadMe.md",
      "not-immediate/deeper/readme.md", "directory/README.md/child.txt")
    val bytes = Exact.utf8("# Readme variant")
    val h = app(f,_.copy(viewerDir=Some(java.nio.file.Path.of(sys.env("MANURE_SOURCE_ROOT"),"manure/web/viewer"))))
    for
      a <- f.artifacts.init(f.identity,InitUpload("readme cases",ArtifactKind.Directory,Visibility.Public,
        files.map(p => ManifestEntry(p,false,bytes.length,SecretCodec.sha256(bytes))),None,Vector.empty,None,None))
      _ <- files.traverse_(p => f.artifacts.putChunk(f.identity,a.artifact.id,p,0,bytes,SecretCodec.sha256(bytes)))
      _ <- f.artifacts.finish(f.identity,a.artifact.id)
      base = s"/view/${a.artifact.id}"
      _ <- Vector("lower" -> "readme.md", "upper" -> "README.md", "prefer-lower" -> "readme.md", "mixed" -> "ReadMe.md").traverse_ { (dir,name) =>
        h.app.run(request(Method.GET,base + "/" + dir + "/")).flatMap { response => response.as[String].map { html =>
          assertEquals(response.status.code,200)
          assert(html.contains("data-kind=\"markdown\""),s"missing Markdown preview for $dir/$name")
          assert(html.contains("data-path=\"" + dir + "/" + name + "\""),s"wrong README preference for $dir")
        }}
      }
      _ <- Vector("not-immediate", "directory").traverse_ { dir =>
        h.app.run(request(Method.GET,base + "/" + dir + "/")).flatMap { response => response.as[String].map { html =>
          assertEquals(response.status.code,200)
          assert(!html.contains("data-kind="),"only immediate regular README files may render")
        }}
      }
    yield ()
  }}
