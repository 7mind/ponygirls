package manure

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import org.http4s.{Header,Method,Request,Uri}
import org.typelevel.ci.CIString
import manure.{api => wire}
import ponygirls.retrieval.postgres.PostgresRetrieval
import java.util.UUID
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
  private def app(f: BackendFixture,adjust: Config => Config = c => c): Http =
    val config = adjust(f.config.copy(apiOrigin=ApiOrigin.parse("http://127.0.0.1:47329"),port=47329))
    val engine = new PostgresRetrieval("manure",None)
    val projection = new SearchProjection(config,engine)
    val search = new Search(f.database.get,f.lease,config,f.auth,f.clock,engine,projection,None)
    new Http(config,f.artifacts,new Catalogue(f.artifacts,config.limits,f.clock),f.auth,f.clock,search)
  private def command(c: wire.Command,token: Option[String],origin: Option[String] = None): Request[IO] =
    request(Method.POST,"/api/current",token,origin).withEntity(CurrentWire.encode(wire.ClientEnvelope.codecJson,
      wire.ClientEnvelope(UUID.fromString("01234567-89ab-4def-8123-456789abcdef"),"1.0.0",c)).noSpaces)
      .putHeaders(Header.Raw(CIString("Content-Type"),"application/json"))
  private def run(body: (BackendFixture,Http) => IO[Unit]): Unit = BackendFixture.resource(true).use(f => body(f,app(f))).unsafeRunSync()
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
    val init = wire.Command.InitUpload("empty",wire.ArtifactKind.Directory,wire.Visibility.Internal,None,Nil)
    for
      bearer <- h.app.run(command(init,Some(f.token)))
      _ <- IO(assertEquals(bearer.status.code,200))
      cookie <- h.app.run(command(init,None).putHeaders(Header.Raw(CIString("Cookie"),"manure-dev="+f.token)))
      _ <- IO(assertEquals(cookie.status.code,403))
      login <- h.app.run(command(wire.Command.Login(f.token),None,Some("http://127.0.0.1:47329")))
      _ <- IO { assertEquals(login.status.code,200); assert(login.headers.headers.exists(x => x.name == CIString("Set-Cookie") && x.value.contains("HttpOnly"))) }
      hostileForm <- h.app.run(request(Method.POST,"/api/current/logout",None,Some("http://attacker.test"))
        .withEntity("").putHeaders(Header.Raw(CIString("Content-Type"),"application/x-www-form-urlencoded"),Header.Raw(CIString("Cookie"),"manure-dev="+f.token)))
      _ <- IO(assertEquals(hostileForm.status.code,403))
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
      initialized <- f.artifacts.init(f.identity,InitUpload("range",ArtifactKind.File,Visibility.Public,Vector(ManifestEntry("a+b.txt",false,bytes.length,SecretCodec.sha256(bytes))),None))
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
      a <- f.artifacts.init(f.identity,InitUpload("site",ArtifactKind.Directory,Visibility.Public,Vector(ManifestEntry("styles.css",false,bytes.length,SecretCodec.sha256(bytes))),None))
      _ <- f.artifacts.putChunk(f.identity,a.artifact.id,"styles.css",0,bytes,SecretCodec.sha256(bytes))
      _ <- f.artifacts.finish(f.identity,a.artifact.id)
      response <- h.app.run(request(Method.GET,s"/view/${a.artifact.id}/styles.css"))
      data <- response.as[String]
      _ <- IO { assertEquals(data,"user css"); assertEquals(response.status.code,200); assert(response.headers.headers.exists(x => x.name == CIString("Content-Security-Policy") && x.value.contains("frame-ancestors 'none'"))); assert(response.headers.headers.exists(x => x.name == CIString("Cache-Control") && x.value == "no-store")) }
      api <- h.app.run(request(Method.POST,s"/view/${a.artifact.id}/api/current",Some(f.token)))
      _ <- IO(assertEquals(api.status.code,404))
    yield ()
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
      external <- f.artifacts.init(f.identity,InitUpload("external forms",ArtifactKind.Directory,Visibility.External,Vector.empty,None))
      _ <- f.artifacts.finish(f.identity,external.artifact.id)
      unlocked <- h.app.run(form(external.artifact.id,"unlock","password="+external.externalPassword.get))
      cookie <- emptyRedirect(unlocked)
      _ <- IO(assert(cookie.startsWith("mgrant-dev-"+external.artifact.id+"=")))
      loggedOut <- h.app.run(form(external.artifact.id,"logout","",Some(cookie)))
      _ <- emptyRedirect(loggedOut)
      _ <- IO(assert(loggedOut.headers.headers.exists(x => x.name==CIString("Set-Cookie") && x.value.contains("Max-Age=0"))))
      internal <- f.artifacts.init(f.identity,InitUpload("internal forms",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None))
      _ <- f.artifacts.finish(f.identity,internal.artifact.id)
      handoff <- f.artifacts.createGrant(f.identity,internal.artifact.id)
      redeemed <- h.app.run(form(internal.artifact.id,"grant","grant="+handoff))
      _ <- emptyRedirect(redeemed)
    yield ()
  }}
  test("locked external landing alone prompts; unknown assets and revoked file grants are never a 200 password form") { run { (f,h) =>
    val bytes=Exact.utf8("private artifact bytes")
    for
      initialized <- f.artifacts.init(f.identity,InitUpload("locked",ArtifactKind.File,Visibility.External,Vector(ManifestEntry("e.txt",false,bytes.length,SecretCodec.sha256(bytes))),None))
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
  test("metadata-only management retrieval filters ready/expiry and excludes payload secrets") { run { (f,h) =>
    val bytes = Exact.utf8("secret payload body no index")
    for
      a <- f.artifacts.init(f.identity,InitUpload("Purple hayneedle",ArtifactKind.File,Visibility.Public,Vector(ManifestEntry("hayneedle.txt",false,bytes.length,SecretCodec.sha256(bytes))),None))
      _ <- f.artifacts.putChunk(f.identity,a.artifact.id,"hayneedle.txt",0,bytes,SecretCodec.sha256(bytes))
      _ <- f.artifacts.finish(f.identity,a.artifact.id)
      query = wire.SearchQuery("hayneedle",wire.SearchMode.Lexical,wire.SearchFilter(None,None,None),20,None)
      unauthorized <- h.app.run(command(wire.Command.Search(query),None))
      _ <- IO(assertEquals(unauthorized.status.code,401))
      response <- h.app.run(command(wire.Command.Search(query),Some(f.token)))
      result <- response.as[String].map(s => CurrentWire.decode(wire.ServerEnvelope.codecJson,CurrentWire.parse(s)))
      _ <- IO { assertEquals(response.status.code,200); assertEquals(result.result.asInstanceOf[wire.Result.SearchResults].page.hits.map(_.artifact.artifactId),List(a.artifact.id)) }
      missing <- h.app.run(command(wire.Command.Search(query.copy(query="secret")),Some(f.token)))
      absent <- missing.as[String].map(s => CurrentWire.decode(wire.ServerEnvelope.codecJson,CurrentWire.parse(s)))
      _ <- IO(assertEquals(absent.result.asInstanceOf[wire.Result.SearchResults].page.hits,Nil))
    yield ()
  }}
