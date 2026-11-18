package haystack.auth

import cats.effect.IO
import haystack.{api}
import haystack.application.ItemService
import haystack.http.{Http,LiveHub,Wire}
import haystack.retrieval.{HaystackRetrieval,ProjectionPolicy}
import haystack.storage.{ContractSuite,Migrations,PostgresItemRepository,TestSupport}
import cats.effect.Deferred
import fs2.Stream
import java.nio.charset.StandardCharsets
import org.http4s.{Header,Method,Request,Response,Status,Uri}
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import ponygirls.auth.{AccountFailure,AccountJson,Password,PasswordHasher,Secrets,Totp}
import ponygirls.retrieval.postgres.PostgresRetrieval
import java.nio.file.Path
import java.time.{Clock,Instant,ZoneOffset}
import java.util.concurrent.atomic.AtomicReference

/** Behavioral Blackbox Good-Communication: production routes and owned PG. */
class AccountHttpTest extends ContractSuite {
  import AuthFixtures.*
  test("legacy token login cannot install an API bearer as a browser session") { directory { dir=>
    val auth=Auth.load(config(dir))
    run(TestSupport.emptyDatabase.use { db=>for{
      _<-Migrations.initialize(db,TestSupport.Activity)
      hub<-LiveHub.create
      retrieval=new HaystackRetrieval(db,ProjectionPolicy("account-test",true,Vector.empty,4096),new PostgresRetrieval("account-test",None),None,4)
      http=new Http(()=>auth,new ItemService(new PostgresItemRepository(db),(_,_)=>IO.unit),hub,None,retrieval,new AccountService(db,()=>auth,imperative))
      ws<-WebSocketBuilder2[IO]
      request=Request[IO](Method.POST,Uri.unsafeFromString("/api/v1/login")).withEntity(Wire.encode(api.LoginRequest.codecJson,api.LoginRequest(AliceToken)).noSpaces).putHeaders(Header.Raw(CIString("Host"),"ts.test:8445"),Header.Raw(CIString("Origin"),Secure),Header.Raw(CIString("Content-Type"),"application/json"))
      response<-http.routes(ws).orNotFound(request)
      _=assertEquals(response.status,Status.Unauthorized)
      _=assert(response.headers.get(CIString("Set-Cookie")).isEmpty)
    }yield()})
  }}
  test("account token mint rejects stale actor even when a different browser cookie is valid") { directory { dir=>
    val cfg=passwordConfig(dir)
    val auth=Auth.load(cfg.copy(users=cfg.users :+ UserConfig("bob","human","Bob",Vector.empty,Some("bob"),cfg.users.head.passwordHashFile,true)))
    run(TestSupport.emptyDatabase.use { db=>for{
      _<-Migrations.initialize(db,TestSupport.Activity)
      accounts=new AccountService(db,()=>auth,imperative)
      _<-accounts.install(auth)
      signed<-accounts.login("bob",AlicePassword,None)
      hub<-LiveHub.create
      retrieval=new HaystackRetrieval(db,ProjectionPolicy("actor-test",true,Vector.empty,4096),new PostgresRetrieval("actor-test",None),None,4)
      http=new Http(()=>auth,new ItemService(new PostgresItemRepository(db),(_,_)=>IO.unit),hub,None,retrieval,accounts)
      ws<-WebSocketBuilder2[IO]
      request=Request[IO](Method.POST,Uri.unsafeFromString("/api/account/v1/tokens")).withEntity("{\"name\":\"wrong-owner\",\"scopes\":[\"api\"]}").putHeaders(Header.Raw(CIString("Host"),"ts.test:8445"),Header.Raw(CIString("Origin"),Secure),Header.Raw(CIString("Cookie"),"__Host-haystack="+signed.session.secret),Header.Raw(CIString("X-Account-Actor"),ponygirls.auth.AccountJson.actor("alice")),Header.Raw(CIString("Content-Type"),"application/json"))
      response<-http.routes(ws).orNotFound(request)
      _=assertEquals(response.status,Status.Conflict)
      duplicate=request.withHeaders(org.http4s.Headers(request.headers.headers :+ Header.Raw(CIString("X-Account-Actor"),ponygirls.auth.AccountJson.actor("bob"))))
      duplicateResponse<-http.routes(ws).orNotFound(duplicate)
      _=assertEquals(duplicateResponse.status,Status.BadRequest)
      current<-accounts.resolve(RequestHeaders("ts.test:8445",cookie=Vector("__Host-haystack="+signed.session.secret)))
      view<-accounts.account(current)
      _=assertEquals(view.tokens,Vector.empty)
    }yield()})
  }}

  // ---- imperative accounts: the Haystack seam (design §9); behaviour itself is the shared contract ----

  private val Now=Instant.parse("2026-11-17T12:00:00Z")
  private val TotpSecret="GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  private val TotpCode=Totp.code(Totp.decodeSecret(TotpSecret).get,Totp.stepAt(Now))
  private val UserPassword="synthetic imperative password"
  /** The one PBKDF2 hash of these cases: the declared admin's. */
  private lazy val adminHash=Password.hash(AlicePassword.toCharArray)
  /** Imperative password hashing is injected: one unsalted SHA-256 in the `Password` text format (the directory
    * validates the shape), so only the declared admin's login pays for PBKDF2. Never a production hasher. */
  private object FastHasher extends PasswordHasher {
    private val Salt=java.util.Base64.getEncoder.encodeToString(new Array[Byte](16))
    def hash(chars:Array[Char]):String=
      s"pbkdf2-sha256$$${Password.iterations}$$$Salt$$${java.util.Base64.getEncoder.encodeToString(java.security.MessageDigest.getInstance("SHA-256").digest(new String(chars).getBytes("UTF-8")))}"
    def verify(chars:Array[Char],encoded:String):Boolean=Secrets.equal(encoded,hash(chars))
  }
  /** Alice is the declared admin with a browser login; `accounts` on with signup. */
  private def accountsConfig(dir:Path,requireApproval:Boolean):AuthConfig={
    val base=config(dir)
    val alice=base.users.head.copy(login=Some("alice"),passwordHashFile=Some(write(dir,"alice.password",adminHash)),admin=true)
    base.copy(users=base.users.updated(0,alice),accounts=Some(AccountsConfig(true,Some(write(dir,"accounts.key",Secrets.generate())),
      SignupConfig(true,requireApproval,100),EnrollmentConfig(false,86400),Some("Haystack test"),Vector.empty)))
  }
  private final class Seam(val db:ponygirls.runtime.JdbcDatabase,val http:Http,val accounts:AccountService,val auth:AtomicReference[Either[Throwable,Auth]],ws:WebSocketBuilder2[IO]) {
    def send(method:Method,path:String,body:Option[String],cookie:Option[String]=None,actor:Option[String]=None,
      origin:Boolean=true,bearer:Option[String]=None):IO[(Response[IO],String)]=
      exchange(method,path,body.map(text=>Stream.emits(text.getBytes(StandardCharsets.UTF_8)).covary[IO]),cookie,actor,origin,bearer)
    /** A POST whose body is held after the route admitted it, while `during` changes the configuration. */
    def held(path:String,body:String,cookie:Option[String],actor:Option[String])(during:IO[Unit]):IO[(Response[IO],String)]=for{
      entered<-Deferred[IO,Unit];release<-Deferred[IO,Unit]
      stream=Stream.eval(entered.complete(())).drain ++ Stream.eval(release.get).drain ++ Stream.emits(body.getBytes(StandardCharsets.UTF_8)).covary[IO]
      fiber<-exchange(Method.POST,path,Some(stream),cookie,actor,true,None).start
      _<-entered.get
      _<-during
      _<-release.complete(())
      result<-fiber.joinWithNever
    }yield result
    private def exchange(method:Method,path:String,body:Option[Stream[IO,Byte]],cookie:Option[String],actor:Option[String],
      origin:Boolean,bearer:Option[String]):IO[(Response[IO],String)]={
      val headers=Vector(Header.Raw(CIString("Host"),"ts.test:8445"))++Option.when(origin)(Header.Raw(CIString("Origin"),Secure))++
        cookie.map(secret=>Header.Raw(CIString("Cookie"),"__Host-haystack="+secret))++actor.map(id=>Header.Raw(CIString("X-Account-Actor"),AccountJson.actor(id)))++
        bearer.map(token=>Header.Raw(CIString("Authorization"),"Bearer "+token))++body.map(_=>Header.Raw(CIString("Content-Type"),"application/json"))
      val request=body.fold(Request[IO](method,Uri.unsafeFromString(path)))(bytes=>Request[IO](method,Uri.unsafeFromString(path)).withBodyStream(bytes))
      http.routes(ws).orNotFound(headers.foldLeft(request)((r,header)=>r.putHeaders(header))).flatMap(response=>response.bodyText.compile.string.map(response->_))
    }
    def login(name:String,password:String):IO[(Response[IO],String)]=
      send(Method.POST,"/api/account/v1/login",Some(s"""{"login":"$name","password":"$password"}"""))
    def signup(name:String):IO[(Response[IO],String)]=send(Method.POST,"/api/account/v1/signup",Some(
      s"""{"username":"$name","email":"$name@example.test","password":"$UserPassword","totpSecret":"$TotpSecret","totpCode":"$TotpCode","requireTotp":false}"""))
  }
  private def cookie(response:Response[IO]):String=
    response.headers.get(CIString("Set-Cookie")).map(_.head.value).getOrElse(fail("session cookie expected")).takeWhile(_!=';').dropWhile(_!='=').drop(1)
  private def code(body:String):String=io.circe.parser.parse(body).toOption.flatMap(_.hcursor.downField("error").get[String]("code").toOption).getOrElse(fail("error body expected"))
  private def seam(initial:Auth)(body:Seam=>IO[Unit]):Unit=run(TestSupport.emptyDatabase.use { db=>
    ImperativeRuntime.resource(Clock.fixed(Now,ZoneOffset.UTC),FastHasher).use { runtime=>for{
      _<-Migrations.initialize(db,TestSupport.Activity)
      reference=new AtomicReference[Either[Throwable,Auth]](Right(initial))
      accounts=new AccountService(db,()=>reference.get().fold(throw _,identity),runtime)
      _<-accounts.install(initial)
      hub<-LiveHub.create
      retrieval=new HaystackRetrieval(db,ProjectionPolicy("imperative-test",true,Vector.empty,4096),new PostgresRetrieval("imperative-test",None),None,4)
      http=new Http(()=>reference.get().fold(throw _,identity),new ItemService(new PostgresItemRepository(db),(_,_)=>IO.unit),hub,None,retrieval,accounts)
      ws<-WebSocketBuilder2[IO]
      _<-body(new Seam(db,http,accounts,reference,ws))
    }yield()}
  })

  test("imperative signup waits for a declared admin's approval, then logs in, reads its profile and logs out; suspension and disable cut its session") { directory { dir=>
    val cfg=accountsConfig(dir,requireApproval=true);val on=Auth.load(cfg);val off=Auth.load(cfg.copy(accounts=None))
    val demoted=Auth.load(cfg.copy(users=cfg.users.updated(0,cfg.users.head.copy(admin=false)):+
      UserConfig("olga","human","Olga",Vector.empty,Some("olga"),cfg.users.head.passwordHashFile,true,admin=true)))
    seam(on) { h=>for{
      (applied,appliedBody)<-h.signup("carol")
      _=assertEquals((applied.status,appliedBody),(Status.Accepted,"""{"status":"pending"}"""))
      _=assert(applied.headers.get(CIString("Set-Cookie")).isEmpty)
      (early,earlyBody)<-h.login("carol",UserPassword)
      _=assertEquals((early.status,code(earlyBody)),(Status.Forbidden,"pending-approval"))
      (admin,_)<-h.login("alice",AlicePassword)
      _<-h.accounts.install(demoted)
      (stale,staleBody)<-h.held("/api/account/v1/admin/users/carol/approve","{}",Some(cookie(admin)),Some("alice"))(IO(h.auth.set(Right(demoted))))
      _=assertEquals((stale.status,code(staleBody)),(Status.Forbidden,"forbidden"))
      (stillPending,stillPendingBody)<-h.login("carol",UserPassword)
      _=assertEquals((stillPending.status,code(stillPendingBody)),(Status.Forbidden,"pending-approval"))
      _<-IO(h.auth.set(Right(on)))
      _<-h.accounts.install(on)
      (approved,approvedBody)<-h.send(Method.POST,"/api/account/v1/admin/users/carol/approve",Some("{}"),Some(cookie(admin)),Some("alice"))
      _=assertEquals((approved.status,approvedBody),(Status.Ok,"""{"ok":true}"""))
      (signed,signedBody)<-h.login("carol",UserPassword)
      _=assertEquals((signed.status,signedBody),(Status.Ok,io.circe.Json.obj("user"->AccountJson.user(ponygirls.auth.AccountUser("carol","human","carol",Some("carol"),None,true,ponygirls.auth.AccountOrigin.Imperative))).noSpaces))
      session=cookie(signed)
      (profile,profileBody)<-h.send(Method.GET,"/api/account/v1/profile",None,Some(session))
      profileJson=io.circe.parser.parse(profileBody).toOption.get.hcursor
      _=assertEquals(profile.status,Status.Ok)
      _=assertEquals((profileJson.get[String]("source").toOption,profileJson.get[Boolean]("admin").toOption,profileJson.get[String]("email").toOption),(Some("imperative"),Some(false),Some("carol@example.test")))
      captured<-h.accounts.resolve(RequestHeaders("ts.test:8445",cookie=Vector("__Host-haystack="+session)))
      _<-IO(h.auth.set(Right(off)))
      _<-h.accounts.live(captured).map(live=>assert(!live,"master off suspends the live socket's session"))
      (suspended,_)<-h.send(Method.GET,"/api/account/v1/profile",None,Some(session))
      _=assertEquals(suspended.status,Status.NotFound)
      _<-IO(h.auth.set(Right(on)))
      _<-h.accounts.live(captured).map(live=>assert(live,"suspension revokes nothing"))
      (out,outBody)<-h.send(Method.POST,"/api/account/v1/logout",Some("{}"),Some(session),Some("carol"))
      _=assertEquals((out.status,outBody),(Status.Ok,"""{"ok":true}"""))
      _=assert(out.headers.get(CIString("Set-Cookie")).exists(_.head.value.contains("Max-Age=0")))
      (again,_)<-h.login("carol",UserPassword)
      capturedAgain<-h.accounts.resolve(RequestHeaders("ts.test:8445",cookie=Vector("__Host-haystack="+cookie(again))))
      (disabled,_)<-h.send(Method.POST,"/api/account/v1/admin/users/carol/enabled",Some("""{"enabled":false}"""),Some(cookie(admin)),Some("alice"))
      _=assertEquals(disabled.status,Status.Ok)
      _<-h.accounts.live(capturedAgain).map(live=>assert(!live,"disable cuts the live socket's session"))
    }yield()}
  }}

  test("account boundary: Origin required, bearer refused, master off answers 404, the existing endpoints keep their bytes") { directory { dir=>
    val cfg=accountsConfig(dir,requireApproval=true);val on=Auth.load(cfg);val off=Auth.load(cfg.copy(accounts=None))
    seam(on) { h=>for{
      (noOrigin,noOriginBody)<-h.send(Method.POST,"/api/account/v1/signup",Some("{}"),origin=false)
      _=assertEquals((noOrigin.status,code(noOriginBody)),(Status.Forbidden,"forbidden"))
      (bearer,bearerBody)<-h.send(Method.GET,"/api/account/v1/policy",None,bearer=Some(AliceToken))
      _=assertEquals((bearer.status,code(bearerBody)),(Status.Unauthorized,"unauthorized"))
      (policy,_)<-h.send(Method.GET,"/api/account/v1/policy",None)
      _=assertEquals(policy.status,Status.Ok)
      (loginOn,loginOnBody)<-h.login("alice",AlicePassword)
      session=cookie(loginOn)
      (issued,issuedBody)<-h.send(Method.POST,"/api/account/v1/tokens",Some("""{"name":"cli","scopes":["api"]}"""),Some(session),Some("alice"))
      _=assertEquals((issued.status,io.circe.parser.parse(issuedBody).toOption.flatMap(_.asObject).map(_.keys.toSet)),(Status.Ok,Some(Set("token","secret"))))
      (rootOn,rootOnBody)<-h.send(Method.GET,"/api/account/v1",None,Some(session))
      (suspendedSignup,suspendedSignupBody)<-h.held("/api/account/v1/signup",
        s"""{"username":"dora","email":"dora@example.test","password":"$UserPassword","totpSecret":"$TotpSecret","totpCode":"$TotpCode","requireTotp":false}""",
        None,None)(IO(h.auth.set(Right(off))))
      (policyOff,policyOffBody)<-h.send(Method.GET,"/api/account/v1/policy",None)
      (signupOff,signupOffBody)<-h.signup("dora")
      _=assertEquals(Vector(suspendedSignup.status->suspendedSignupBody,policyOff.status->policyOffBody,signupOff.status->signupOffBody),
        Vector.fill(3)(Status.NotFound->AccountJson.failure("not-found").noSpaces))
      (loginOff,loginOffBody)<-h.login("alice",AlicePassword)
      (rootOff,rootOffBody)<-h.send(Method.GET,"/api/account/v1",None,Some(session))
      _=assertEquals(Vector(loginOff.status->loginOffBody,rootOff.status->rootOffBody),Vector(loginOn.status->loginOnBody,rootOn.status->rootOnBody))
      (out,outBody)<-h.send(Method.POST,"/api/account/v1/logout",Some("{}"),Some(cookie(loginOff)),Some("alice"))
      _=assertEquals((out.status,outBody),(Status.Ok,"""{"ok":true}"""))
      _<-IO(h.auth.set(Right(on)))
      (dora,doraBody)<-h.login("dora",UserPassword)
      _=assertEquals((dora.status,code(doraBody)),(Status.Unauthorized,"unauthorized"),"the suspended signup created no application")
    }yield()}
  }}

  test("a retained author id cannot be registered and a reload whose declared login collides with an imperative account fails closed") { directory { dir=>
    val cfg=accountsConfig(dir,requireApproval=false)
    seam(Auth.load(cfg)) { h=>for{
      _<-new PostgresItemRepository(h.db).commit(TestSupport.op("p:retained"),haystack.domain.Principal("erin","agent","removed"),TestSupport.Now)
      (retained,retainedBody)<-h.signup("erin")
      _=assertEquals((retained.status,code(retainedBody)),(Status.Conflict,"username-unavailable"))
      (created,_)<-h.signup("frank")
      _=assertEquals(created.status,Status.Ok)
      colliding=cfg.copy(users=cfg.users:+UserConfig("frank-ops","human","Frank",Vector.empty,Some("Frank"),cfg.users.head.passwordHashFile,true))
      reloaded<-h.accounts.reloaded(IO(Auth.load(colliding)))
      _=assertEquals(reloaded.left.toOption,Some(AccountFailure("config")))
      _<-IO(h.auth.set(reloaded))
      (closed,closedBody)<-h.send(Method.GET,"/api/v1/whoami",None,bearer=Some(AliceToken),origin=false)
      _=assertEquals((closed.status,closedBody.contains("\"unavailable\"")),(Status.ServiceUnavailable,true))
    }yield()}
  }}
}
