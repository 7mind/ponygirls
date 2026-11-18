package haystack.auth

import cats.effect.IO
import haystack.application.ItemService
import haystack.http.{Http,LiveHub}
import haystack.retrieval.{HaystackRetrieval,ProjectionPolicy}
import haystack.storage.{ContractSuite,Migrations,PostgresItemRepository,TestSupport}
import java.nio.file.{Files,Path}
import java.nio.file.attribute.FileTime
import java.time.Instant
import org.http4s.{Header,HttpApp,Method,Request,Response,Status,Uri}
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import ponygirls.retrieval.postgres.PostgresRetrieval

/** Behavioral Blackbox Good-Communication: real routes, files and owned PG. */
class StaticAssetsHttpTest extends ContractSuite {
  import AuthFixtures.*
  private val NixTimestamp=FileTime.from(Instant.ofEpochSecond(1))
  private def header(response:Response[IO],name:String):String=
    response.headers.headers.find(_.name==CIString(name)).map(_.value).getOrElse(fail(s"missing $name"))
  private def request(name:String):Request[IO]=Request[IO](Method.GET,Uri.unsafeFromString("/"+name)).putHeaders(Header.Raw(CIString("Host"),"ts.test:8445"))
  private def withApp(dir:Path)(check:(HttpApp[IO],Path)=>IO[Unit]):IO[Unit]=TestSupport.emptyDatabase.use { db=>
    val auth=Auth.load(config(dir))
    for {
      root<-IO.blocking(Files.createDirectory(dir.resolve("web")))
      _<-Migrations.initialize(db,TestSupport.Activity)
      hub<-LiveHub.create
      retrieval=new HaystackRetrieval(db,ProjectionPolicy("static-test",true,Vector.empty,4096),new PostgresRetrieval("static-test",None),None,4)
      http=new Http(()=>auth,new ItemService(new PostgresItemRepository(db),(_,_)=>IO.unit),hub,Some(root),retrieval,new AccountService(db,()=>auth,imperative))
      ws<-WebSocketBuilder2[IO]
      _<-check(http.routes(ws).orNotFound,root)
    } yield ()
  }
  Vector("account.js","account.css","ui/tokens.css").foreach { name=>
    test(s"fixed $name serves replacement bytes despite equal size and Nix timestamp") { directory { dir=>run(withApp(dir) { (app,root)=>
      val file=root.resolve(name)
      val original="/* account version 1 */\n"
      val replacement="/* account version 2 */\n"
      for {
        _<-IO.blocking { Files.createDirectories(file.getParent);Files.writeString(file,original);Files.setLastModifiedTime(file,NixTimestamp) }
        first<-app(request(name))
        firstBody<-first.as[String]
        _=assertEquals(first.status,Status.Ok)
        _=assertEquals(firstBody,original)
        conditional=request(name).putHeaders(Header.Raw(CIString("If-None-Match"),header(first,"ETag")),Header.Raw(CIString("If-Modified-Since"),header(first,"Last-Modified")))
        _<-IO.blocking { Files.writeString(file,replacement);Files.setLastModifiedTime(file,NixTimestamp) }
        current<-app(conditional)
        currentBody<-current.as[String]
        _=assertEquals(current.status,Status.Ok)
        _=assertEquals(currentBody,replacement)
        _=assertEquals(header(current,"Cache-Control"),"no-store")
      } yield ()
    })}}
  }
  test("immutable-name static bundles retain conditional caching") { directory { dir=>run(withApp(dir) { (app,root)=>
    val name="index-12345678.js"
    for {
      _<-IO.blocking(Files.writeString(root.resolve(name),"/* immutable */\n"))
      first<-app(request(name))
      _<-first.body.compile.drain
      cached<-app(request(name).putHeaders(Header.Raw(CIString("If-None-Match"),header(first,"ETag"))))
      _<-cached.body.compile.drain
      _=assertEquals(cached.status,Status.NotModified)
      _=assertEquals(header(cached,"Cache-Control"),"public, max-age=31536000, immutable")
    } yield ()
  })}}
}
