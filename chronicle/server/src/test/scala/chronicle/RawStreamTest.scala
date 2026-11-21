package chronicle

import cats.effect.IO
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import chronicle.api.*
import distage.*
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID
import org.http4s.{Http as _,Message as _,*}
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString

final class RawStreamGraph(val http: Http,val auth: Auth,val archive: PostgresArchive,val db: Database)

/** Raw downloads over HTTP (ingest limits spec §1.7, server): the production routes and graph on the suite's database,
  * with 7-byte windows and one download permit. */
final class RawStreamTest extends munit.FunSuite {
  import UploadFixtures.*
  private val window=7
  private final case class Answer(status: Status,headers: Map[String,String],chunks: List[Array[Byte]]) {
    def bytes: Array[Byte] = chunks.toArray.flatten
    def code: String = Wire.decode(Failure.codecJson,Wire.parse(new String(bytes,UTF_8))).code
  }
  /** GET requests as a browser on the configured origin sends them, with the session cookie when given. */
  private final class Browser(app: HttpApp[IO],config: Config) {
    val origin: String = config.allowedOrigin
    def request(path: String,cookie: Option[String],headers: (String,String)*): Request[IO] = {
      val host="Host" -> java.net.URI.create(origin).getRawAuthority
      val sent=host::cookie.map(secret => "Cookie" -> s"chronicle_session=$secret").toList++headers
      Request[IO](Method.GET,Uri.unsafeFromString(path)).putHeaders(sent.map((name,value) => Header.Raw(CIString(name),value))*)
    }
    def respond(request: Request[IO]): IO[Response[IO]] = app(request)
    def read(response: Response[IO]): IO[Answer] =
      response.body.chunks.map(_.toArray).compile.toList.map(Answer(response.status,response.headers.headers.map(h => h.name.toString -> h.value).toMap,_))
    def get(path: String,cookie: Option[String],headers: (String,String)*): IO[Answer] = respond(request(path,cookie,headers*)).flatMap(read)
  }
  private def routes(f: (Browser,RawStreamGraph,String) => IO[Unit]): Unit = database { (config,_,_) =>
    val production: Module=_root_.chronicle.plugins.ChroniclePlugin
    val module=production.overriddenBy(new ModuleDef {
      make[Config].fromValue(config); make[org.http4s.client.Client[IO]].fromValue(org.http4s.client.Client.fromHttpApp[IO](HttpApp.notFound[IO]))
      make[RawStream.Policy].fromValue(RawStream.Policy(window,window,1)); make[RawStreamGraph]
    })
    ChronicleInjector().produceGet[RawStreamGraph](module).use { graph => for {
      ws <- WebSocketBuilder2[IO]
      gate <- Semaphore[IO](2)
      cookie <- IO.blocking(graph.auth.login(LoginRequest("a","synthetic"))._2)
      _ <- f(new Browser(graph.http.routes(ws,gate).orNotFound,config),graph,cookie)
    } yield () }.unsafeRunSync()
  }
  /** An epoch revision 3 of three segments (one shorter, two longer than a window, with characters a window cuts) and its
    * revisions 1 and 2 in the same epoch. */
  private def epochSession(archive: PostgresArchive): (UUID,List[Content]) = {
    val identity=source()
    val first=header(3)++pi("u1","s","user","first question λ🐎",1)++pi("a1","u1","assistant","an answer with 🐎🐎 and ünïcode",2)
    val second=first++Content(List("{}"),Nil)
    val third=second++Content(List("""{"type":"custom","data":"λλλ🐎🐎 a line longer than a window"}"""),Nil)
    val id=archive.ingest("a",request(identity,0,first)).sessionId
    archive.ingest("a",request(identity,1,second)); archive.ingest("a",request(identity,2,third))
    (id,List(first,second,third))
  }
  private def raw(archive: PostgresArchive,id: UUID,revision: Int): List[Array[Byte]] = archive.raw("a",id,Some(revision)).files.map(_.content.getBytes(UTF_8))
  private def windows(bytes: Int): List[Int] = List.fill(bytes/window)(window)++Option(bytes%window).filter(_>0)

  test("windows of an injected size concatenate to the GetRaw bytes of epoch and legacy revisions; manifests, ranges, validators and production sizes") { routes { (client,graph,cookie) => IO.blocking {
    assertEquals(RawStream.Policy.production,RawStream.Policy(4*1024*1024,16*1024*1024,4))
    assertEquals(ChronicleInjector().produceGet[RawStream.Policy](_root_.chronicle.plugins.ChroniclePlugin: Module).use(IO.pure).unsafeRunSync(),RawStream.Policy.production)
    val (id,contents)=epochSession(graph.archive)
    graph.db.transaction { c =>
      assertEquals(Sql.rows(c,"SELECT octet_length(content) FROM ch_epoch_raw WHERE epoch=? ORDER BY byte_offset",epochOf(c,id,3).get)(_.getInt(1)).map(size => if(size<window) "short" else "long"),List("long","short","long"))
    }
    val ok=Some(cookie)
    (1 to 3).foreach { revision =>
      val expected=raw(graph.archive,id,revision).head; val sha256=Wire.hash(contents(revision-1).raw)
      val whole=client.get(s"/api/raw/$id/$revision/0",ok).unsafeRunSync()
      assertEquals((whole.status,whole.bytes.toList,whole.chunks.map(_.length)),(Status.Ok,expected.toList,windows(expected.length)),s"revision $revision")
      assertEquals(whole.headers,Map("Content-Length" -> expected.length.toString,"Content-Type" -> "application/octet-stream",
        "Content-Disposition" -> s"""attachment; filename="chronicle-$id-r$revision-f0.jsonl"""","ETag" -> s""""sha256:$sha256"""",
        "Repr-Digest" -> s"sha-256=:${java.util.Base64.getEncoder.encodeToString(java.util.HexFormat.of().parseHex(sha256))}:",
        "Accept-Ranges" -> "bytes","Cache-Control" -> "no-store","X-Content-Type-Options" -> "nosniff"))
      val manifest=Wire.decode(RawManifest.codecJson,Wire.parse(new String(client.get(s"/api/raw/$id/$revision",ok).unsafeRunSync().bytes,UTF_8)))
      assertEquals(manifest,RawManifest(id,revision,List(RawFileInfo(0,"session.jsonl",sha256,expected.length.toLong))))
    }
    assertEquals(Wire.decode(RawManifest.codecJson,Wire.parse(new String(client.get(s"/api/raw/$id",ok).unsafeRunSync().bytes,UTF_8))).revision,3,"the head")
    val head=raw(graph.archive,id,3).head; val total=head.length; val etag=s""""sha256:${Wire.hash(contents(2).raw)}""""
    def ranged(range: String,headers: (String,String)*): Answer = client.get(s"/api/raw/$id/3/0",ok,(("Range" -> range)+:headers)*).unsafeRunSync()
    List(("bytes=5-40",5,41),("bytes=7-",7,total),("bytes=-10",total-10,total),(s"bytes=${total-3}-99999999999999999999",total-3,total),("BYTES=0-0",0,1)).foreach { (range,from,until) =>
      val answer=ranged(range,"If-Range" -> etag)
      assertEquals((answer.status,answer.headers.get("Content-Range"),answer.bytes.toList),(Status.PartialContent,Some(s"bytes $from-${until-1}/$total"),head.slice(from,until).toList),range)
      assertEquals(answer.headers.get("Content-Length"),Some((until-from).toString),range)
    }
    val ignored=ranged("bytes=5-40","If-Range" -> "\"sha256:another\"")
    assertEquals((ignored.status,ignored.headers.get("Content-Range"),ignored.bytes.toList),(Status.Ok,None,head.toList),"If-Range of other bytes: the whole file")
    val unsatisfiable=ranged(s"bytes=$total-")
    assertEquals((unsatisfiable.status,unsatisfiable.code,unsatisfiable.headers.get("Content-Range")),(Status.RangeNotSatisfiable,"range-not-satisfiable",Some(s"bytes */$total")))
    List("bytes=0-1,3-4","bytes=5-4","bytes=9223372036854775809-9223372036854775808","items=0-1","bytes=").foreach { range => val answer=ranged(range); assertEquals((answer.status,answer.code),(Status.BadRequest,"invalid"),range) }

    // Two files of a legacy revision, the second without a final newline.
    val files=List(RawFile("a.jsonl",Wire.hash(contents(0).raw),contents(0).raw),RawFile("sub/b.jsonl","","""{"type":"custom","data":"λ🐎 second file"}"""))
      .map(file => file.copy(sha256=Wire.hash(file.content)))
    val legacy=graph.archive.ingest("a",request(source(),0,contents(0)).copy(digest=Wire.hash(files.map(_.content).mkString),files=files)).sessionId
    graph.db.transaction(c => assertEquals(epochOf(c,legacy,1),None))
    assertEquals(Wire.decode(RawManifest.codecJson,Wire.parse(new String(client.get(s"/api/raw/$legacy/1",ok).unsafeRunSync().bytes,UTF_8))).files,
      files.zipWithIndex.map((file,index) => RawFileInfo(index,file.path,file.sha256,file.content.getBytes(UTF_8).length.toLong)))
    raw(graph.archive,legacy,1).zipWithIndex.foreach { (expected,index) =>
      val whole=client.get(s"/api/raw/$legacy/1/$index",ok).unsafeRunSync()
      assertEquals((whole.status,whole.bytes.toList,whole.chunks.map(_.length)),(Status.Ok,expected.toList,windows(expected.length)),s"file $index")
      val part=client.get(s"/api/raw/$legacy/1/$index",ok,"Range" -> "bytes=3-30").unsafeRunSync()
      assertEquals((part.status,part.bytes.toList),(Status.PartialContent,expected.slice(3,31).toList),s"file $index")
    }
    assertEquals(client.get(s"/api/raw/$legacy/1/2",ok).unsafeRunSync().code,"not-found")
  }}}

  test("browser session only, at the account boundary: no cookie, a Raw bearer, a query, a foreign Origin, another owner, bad paths") { routes { (client,graph,cookie) => IO.blocking {
    val (id,_)=epochSession(graph.archive)
    val token=graph.auth.mutate(graph.auth.browser(cookie),ClientEnvelope(UUID.randomUUID(),Operation.MintToken("raw",List(Scope.Read,Scope.Raw)))).asInstanceOf[Result.Token].result.secret.get
    val other=graph.auth.login(LoginRequest("b","synthetic"))._2
    def answer(path: String,cookie: Option[String],headers: (String,String)*): (Status,String) = { val a=client.get(path,cookie,headers*).unsafeRunSync(); (a.status,a.code) }
    List(s"/api/raw/$id",s"/api/raw/$id/1/0").foreach { path =>
      assertEquals(answer(path,None),(Status.Unauthorized,"unauthorized"),path)
      assertEquals(answer(path,None,"Authorization" -> s"Bearer $token"),(Status.Forbidden,"forbidden"),path)
      assertEquals(answer(s"$path?x=1",Some(cookie)),(Status.BadRequest,"invalid"),path)
      assertEquals(answer(path,Some(cookie),"Origin" -> "https://elsewhere.example"),(Status.Forbidden,"forbidden"),path)
      assertEquals(answer(path,Some(other)),(Status.NotFound,"not-found"),path)
      assertEquals(client.get(path,Some(cookie),"Origin" -> client.origin).unsafeRunSync().status,Status.Ok,path)
    }
    assertEquals(answer(s"/api/raw/$id/0",Some(cookie)),(Status.BadRequest,"invalid"))
    assertEquals(answer(s"/api/raw/$id/1/0/more",Some(cookie)),(Status.NotFound,"not-found"),"a Failure body on every path under /api/raw")
  }}}

  /** Reads the body of `path`, running `between` once its first window was consumed: its length, the bytes received and
    * the code the body failed with. */
  private def download(client: Browser,path: String,cookie: String)(between: => Unit): (Long,List[Byte],Option[String]) = {
    val response=client.respond(client.request(path,Some(cookie))).unsafeRunSync()
    assertEquals(response.status,Status.Ok)
    val received=List.newBuilder[Byte]
    val failed=response.body.chunks.zipWithIndex.evalMap((chunk,index) => IO.blocking { received ++= chunk.toList; if(index==0) between }).compile.drain.attempt.unsafeRunSync()
    (response.contentLength.get,received.result(),failed.left.toOption.map { case d: DomainError => d.code; case other => throw other })
  }

  test("after the first window an append leaves the pinned bytes unchanged; a logout, a disabled account or a purge ends the body short of its length") { routes { (client,graph,cookie) => IO.blocking {
    val identity=source()
    val first=header(3)++pi("u1","s","user","first question λ🐎",1)
    val id=graph.archive.ingest("a",request(identity,0,first)).sessionId
    val expected=first.raw.getBytes(UTF_8).toList
    assertEquals(download(client,s"/api/raw/$id/1/0",cookie)(graph.archive.ingest("a",request(identity,1,first++pi("a1","u1","assistant","appended",2)))),
      (expected.length.toLong,expected,None))
    val other=graph.auth.login(LoginRequest("a","synthetic"))._2
    assertEquals(download(client,s"/api/raw/$id/1/0",other)(graph.auth.logout(graph.auth.browser(other))),(expected.length.toLong,expected.take(window),Some("unauthorized")))
    def enabled(value: Boolean): Unit = graph.db.transaction(c => { Sql.exec(c,"UPDATE ch_users SET enabled=? WHERE id='a'",value); () })
    val disabled=download(client,s"/api/raw/$id/1/0",cookie)(enabled(false))
    enabled(true)
    assertEquals(disabled,(expected.length.toLong,expected.take(window),Some("unauthorized")))
    assertEquals(download(client,s"/api/raw/$id/1/0",cookie)(graph.auth.mutate(graph.auth.browser(cookie),ClientEnvelope(UUID.randomUUID(),Operation.Purge(id)))),
      (expected.length.toLong,expected.take(window),Some("not-found")))
  }}}

  test("one permit: a second download is refused before any byte; an abandoned, a finished, a refused range and a failed pin return it") { routes { (client,graph,cookie) => IO.blocking {
    val (id,_)=epochSession(graph.archive)
    val path=s"/api/raw/$id/3/0"
    val held=client.respond(client.request(path,Some(cookie))).unsafeRunSync()
    val refused=client.get(path,Some(cookie)).unsafeRunSync()
    assertEquals((refused.status,refused.code,refused.headers.get("Retry-After")),(Status.ServiceUnavailable,"unavailable",Some("5")))
    assertEquals(client.get(s"/api/raw/$id",Some(cookie)).unsafeRunSync().status,Status.Ok,"manifests take no permit")
    // A client that disconnects after one window: the body is abandoned after its first chunk.
    assertEquals(held.body.chunks.take(1).compile.toList.unsafeRunSync().map(_.size),List(window))
    assertEquals(client.get(path,Some(cookie),"Range" -> "bytes=999999-").unsafeRunSync().status,Status.RangeNotSatisfiable)
    assertEquals(client.get(s"/api/raw/$id/3/1",Some(cookie)).unsafeRunSync().status,Status.NotFound)
    assertEquals(client.get(path,Some(cookie)).unsafeRunSync().status,Status.Ok)
    assertEquals(client.get(path,Some(cookie)).unsafeRunSync().status,Status.Ok,"the finished download returned its permit")
  }}}
}
