package chronicle

import cats.effect.IO
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import distage.*
import org.http4s.{Http as _,*}
import org.http4s.ember.client.EmberClientBuilder
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import java.nio.file.{Files,Path}
import java.nio.file.attribute.FileTime

class StaticHttpTest extends munit.FunSuite {
  private val oldHtml="<script src='app-aaaa1111.js'></script>"
  private val newHtml="<script src='app-bbbb2222.js'></script>"
  private val asset="/app-aaaa1111.js"
  private def header(r: Response[IO],name: String): Option[String]=r.headers.get(CIString(name)).map(_.head.value)
  private def security(r: Response[IO]): Unit = {
    assertEquals(header(r,"X-Content-Type-Options"),Some("nosniff"))
    assertEquals(header(r,"Referrer-Policy"),Some("no-referrer"))
    assert(header(r,"Content-Security-Policy").exists(_.contains("frame-ancestors 'none'")))
  }
  // Real filesystem semantics are essential here: a dummy cannot expose http4s metadata validators.
  private def withRoutes(f: (HttpApp[IO],Path) => IO[Unit]): Unit = {
    val fixture=cats.effect.Resource.make(IO.blocking {
      val dir=Files.createTempDirectory("chronicle-static-")
      Files.writeString(dir.resolve("index.html"),oldHtml)
      // Identical metadata to the old entry point obtains its legacy validators through the public route.
      Files.writeString(dir.resolve(asset.stripPrefix("/")),oldHtml)
      Files.setLastModifiedTime(dir.resolve("index.html"),FileTime.fromMillis(1000))
      Files.setLastModifiedTime(dir.resolve(asset.stripPrefix("/")),FileTime.fromMillis(1000))
      dir
    })(dir => IO.blocking {
      val paths=Files.walk(dir)
      try paths.sorted(java.util.Comparator.reverseOrder[Path]()).forEach(p => { Files.delete(p); () }) finally paths.close()
    })
    fixture.use { dir =>
      EmberClientBuilder.default[IO].build.use { client =>
        val production: Module=_root_.chronicle.plugins.ChroniclePlugin
        val module=production.overriddenBy(new ModuleDef {
          make[Config].fromValue(Fixtures.config())
          make[org.http4s.client.Client[IO]].fromValue(client)
          make[Http.WebRoot].fromValue(Http.WebRoot(Some(dir.toString)))
        })
        Injector().produceGet[Http](module).toEffect[IO].use { http =>
          for {
            gate <- Semaphore[IO](2)
            ws <- WebSocketBuilder2[IO]
            _ <- f(http.routes(ws,gate).orNotFound,dir)
          } yield ()
        }
      }
    }.unsafeRunSync()
  }
  private def get(app: HttpApp[IO],path: String): IO[Response[IO]] = get(app,path,Nil)
  private def get(app: HttpApp[IO],path: String,headers: List[(String,String)]): IO[Response[IO]] =
    app(Request[IO](Method.GET,Uri.unsafeFromString(path)).putHeaders(headers.map { case (k,v) => Header.Raw(CIString(k),v) }*))

  for(path <- List("/","/index.html"); condition <- List("If-None-Match","If-Modified-Since","both")) {
    // regression: GitHub #34 — Nix builds share mtime=1 and equal-length HTML shares its ETag.
    test(s"Blackbox-GoodCommunication regression #34: $path ignores stale $condition after equal-metadata HTML replacement") {
      withRoutes { (app,dir) => for {
        before <- get(app,path)
        beforeBody <- before.as[String]
        _ <- IO { assertEquals(before.status,Status.Ok); assertEquals(beforeBody,oldHtml) }
        legacy <- get(app,asset)
        _ <- IO {
          assertEquals(legacy.status,Status.Ok)
          assert(header(legacy,"ETag").nonEmpty)
          assert(header(legacy,"Last-Modified").nonEmpty)
          assertEquals(oldHtml.length,newHtml.length)
          Files.writeString(dir.resolve("index.html"),newHtml)
          Files.setLastModifiedTime(dir.resolve("index.html"),FileTime.fromMillis(1000))
        }
        validators=List("If-None-Match" -> header(legacy,"ETag").get,"If-Modified-Since" -> header(legacy,"Last-Modified").get)
        response <- get(app,path,if(condition=="both") validators else validators.filter(_._1==condition))
        body <- response.as[String]
        _ <- IO {
          assertEquals(response.status,Status.Ok,s"changed HTML must not produce a stale 304 for $condition")
          assertEquals(body,newHtml)
          assertEquals(header(response,"Cache-Control"),Some("no-store"))
          assertEquals(header(response,"ETag"),None)
          assertEquals(header(response,"Last-Modified"),None)
          security(response)
        }
      } yield () }
    }
  }
  test("Blackbox-GoodCommunication: HTML is never stored; hashed asset conditional caching and security headers are preserved") {
    withRoutes { (app,_) => for {
      html <- get(app,"/")
      body <- html.as[String]
      _ <- IO {
        assertEquals(body,oldHtml)
        assertEquals(header(html,"Cache-Control"),Some("no-store"))
        assertEquals(header(html,"ETag"),None)
        assertEquals(header(html,"Last-Modified"),None)
        security(html)
      }
      original <- get(app,asset)
      originalBody <- original.as[String]
      _ <- IO { assertEquals(original.status,Status.Ok); assertEquals(originalBody,oldHtml); security(original) }
      _ <- List("If-None-Match" -> header(original,"ETag").get,"If-Modified-Since" -> header(original,"Last-Modified").get).foldLeft(IO.unit) { case (previous,validator) => previous *> (for {
        cached <- get(app,asset,List(validator))
        cachedBody <- cached.as[String]
        _ <- IO {
          assertEquals(cached.status,Status.NotModified)
          assertEquals(cachedBody,"")
          assertEquals(header(cached,"Cache-Control"),header(original,"Cache-Control"))
          assert(!header(cached,"Cache-Control").contains("no-store"))
          security(cached)
        }
      } yield ()) }
    } yield () }
  }
  test("Blackbox-GoodCommunication: unknown API and missing static paths do not fall back to HTML; traversal and escaping symlinks stay blocked") {
    withRoutes { (app,dir) =>
      val outside=dir.resolveSibling(dir.getFileName.toString+"-outside")
      cats.effect.Resource.make(IO.blocking {
        Files.writeString(outside,"outside")
        Files.createSymbolicLink(dir.resolve("escape.js"),outside)
        Files.createDirectories(dir.resolve("api"))
        Files.writeString(dir.resolve("api/missing"),"not an API")
      })(_ => IO.blocking { Files.deleteIfExists(outside); () }).use { _ =>
        List("/api/missing","/missing","/../"+outside.getFileName.toString,"/escape.js").foldLeft(IO.unit) { (previous,path) =>
          previous *> get(app,path).flatMap(r => IO(assertEquals(r.status,Status.NotFound,path)))
        }
      }
    }
  }
}
