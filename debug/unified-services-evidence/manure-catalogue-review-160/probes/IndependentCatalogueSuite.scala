package manure

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.{Decoder,Json}
import java.nio.file.{Files,Path}
import java.util.Base64
import manure.{api=>wire}
import munit.FunSuite
import scala.concurrent.duration.*

/** Independent actual legacy SQLite oracle, not expectations computed by the new policy. */
abstract class IndependentCatalogueContract(postgres:Boolean) extends FunSuite {
  override val munitTimeout=90.seconds
  private val oracle=CurrentWire.parse(Files.readString(Path.of(sys.env("MANURE_REVIEW_ORACLE"))))
  private def get[A:Decoder](j:Json,key:String):A=j.hcursor.get[A](key).toOption.get
  private def vector(key:String)=get[Vector[Json]](oracle,key)
  private def row(j:Json):Artifact=Artifact(get(j,"id"),get(j,"name"),ArtifactKind.parse(get(j,"kind")),Visibility.parse(get(j,"visibility")),get(j,"created_by_user"),get(j,"created_by_token"),get(j,"created_at"),get(j,"created_at_s"),get[Option[String]](j,"expires_at"),get[Option[Double]](j,"expires_at_s"),UploadState.parse(get(j,"state")),get(j,"total_bytes"),get(j,"file_count"),get(j,"reserved_bytes"),None,get(j,"last_activity_at"),get(j,"manifest_json"))
  private val sorts=Vector(wire.CatalogueSort.Name->"name",wire.CatalogueSort.CreatedAt->"created_at",wire.CatalogueSort.ExpiresAt->"expires_at",wire.CatalogueSort.TotalBytes->"total_bytes",wire.CatalogueSort.FileCount->"file_count",wire.CatalogueSort.Visibility->"visibility",wire.CatalogueSort.State->"state",wire.CatalogueSort.Kind->"kind",wire.CatalogueSort.CreatedByUser->"created_by_user")
  private def query(text:String="",sort:wire.CatalogueSort=wire.CatalogueSort.Name,direction:wire.SortDirection=wire.SortDirection.Asc,limit:Int=2)=wire.CatalogueQuery(text,true,None,None,sort,direction,limit,None)
  private def cat(f:BackendFixture)=new Catalogue(f.artifacts,f.config.limits,f.clock)
  private def seed(f:BackendFixture,key:String)=f.metadata.transaction(tx=>vector(key).map(row).foreach(tx.put))
  private def run(key:String)(body:BackendFixture=>IO[Unit]):Unit=BackendFixture.resource(postgres).use(f=>seed(f,key) *> body(f)).unsafeRunSync()
  private def walk(f:BackendFixture,q:wire.CatalogueQuery,cursor:Option[String]=None,seen:Vector[String]=Vector.empty):IO[Vector[String]]=
    cat(f).list(f.other,q.copy(cursor=cursor)).flatMap{(page,next)=>
      val ids=page.map(_.id)
      IO{assert(page.size<=q.limit);assert(seen.size<=30);assert(!ids.exists(seen.contains))} *>
        next.fold(IO.pure(seen++ids))(token=>walk(f,q,Some(token),seen++ids))
    }
  test("actual acknowledged legacy full-casefold names vs current adapter (independent oracle)") {run("ackRows"){f=>for{
    observed<-vector("matching").traverse{c=>
      val text=get[String](c,"query");val expected=get[Vector[String]](c,"names")
      cat(f).list(f.identity,query(text,limit=50)).map{(page,_)=>
        val actual=page.map(_.name)
        println(Json.obj("probe"->Json.fromString("CASEFOLD"),"pg"->Json.fromBoolean(postgres),"q"->Json.fromString(text),"legacy"->Json.fromValues(expected.map(Json.fromString)),"current"->Json.fromValues(actual.map(Json.fromString))).noSpaces)
        (actual,expected)
      }
    }
    _<-IO(observed.foreach((actual,expected)=>assertEquals(actual,expected)))
  }yield()}}
  test("case-equivalent ASCII query retains current-version cursor meaning; no old cursor supplied") {run("ackRows"){f=>for{
    first<-cat(f).list(f.identity,query("cat",limit=1))
    second<-cat(f).list(f.identity,query("CAT",limit=1).copy(cursor=first._2)).attempt
    expected=get[Vector[String]](oracle.hcursor.downField("equivalentCursor").focus.get,"secondNames")
    _<-IO{
      println(s"REVIEW_EQUIVALENT_CURSOR pg=$postgres legacyAccepted=true currentError=${second.left.toOption.map(_.getClass.getSimpleName)}")
      assertEquals(second.toOption.map(_._1.map(_.name)),Some(expected))
    }
  }yield()}}
  test("legacy accepted 1025-character literal query is functionally admitted, not new policy cap") {run("ackRows"){f=>for{
    result<-cat(f).list(f.identity,query("x"*1025,limit=50)).attempt
    _<-IO{println(s"REVIEW_QUERY_LENGTH pg=$postgres length=1025 legacyAccepted=true currentAccepted=${result.isRight}");assertEquals(result.toOption.map(_._1.map(_.name)),Some(Vector.empty[String]))}
  }yield()}}
  test("18 typed sort traversals, NUL/astral byte ordering, null-last expiry both directions, four expiry/filter controls vs actual old SQL") {run("sortRows"){f=>for{
    _<-vector("sorts").traverse_{c=>
      val sort=sorts.find(_._2==get[String](c,"sort")).get._1
      val direction=if get[String](c,"direction")=="asc" then wire.SortDirection.Asc else wire.SortDirection.Desc
      walk(f,query(sort=sort,direction=direction)).map(actual=>assertEquals(actual,get[Vector[String]](c,"ids")))
    }
    _<-vector("filters").traverse_{c=>
      val vis=get[Option[String]](c,"visibility").map(v=>wire.Visibility.all.find(_.toString.toLowerCase(java.util.Locale.ROOT)==v).get)
      val state=get[Option[String]](c,"state").map(v=>wire.ArtifactState.all.find(_.toString.toLowerCase(java.util.Locale.ROOT)==v).get)
      val q=query(sort=wire.CatalogueSort.ExpiresAt,direction=wire.SortDirection.Desc,limit=1).copy(includeExpired=false,visibility=vis,state=state)
      walk(f,q).map(actual=>assertEquals(actual,get[Vector[String]](c,"ids")))
    }
    _<-IO(println(s"REVIEW_ORDER_FILTER pg=$postgres sortTraversals=18 filterTraversals=4 expectedLegacyIds=true"))
  }yield()}}
  test("current cursor changed options and wrong text/count/time types reject before database work") {run("sortRows"){f=>for{
    first<-cat(f).list(f.identity,query())
    changed<-Vector(query().copy(limit=1),query().copy(includeExpired=false),query().copy(sort=wire.CatalogueSort.State),query().copy(direction=wire.SortDirection.Desc)).traverse{q=>cat(f).list(f.identity,q.copy(cursor=first._2)).attempt}
    _<-IO(changed.foreach(r=>assertEquals(r.left.toOption.collect{case e:DomainError=>e.code},Some("bad-envelope"))))
    _<-Vector(wire.CatalogueSort.Name->Json.fromInt(1),wire.CatalogueSort.TotalBytes->Json.fromDoubleOrNull(0.5),wire.CatalogueSort.CreatedAt->Json.fromString("bad"),wire.CatalogueSort.ExpiresAt->Json.True).traverse_{(sort,bad)=>
      val q=query(sort=sort)
      cat(f).list(f.identity,q).flatMap{(_,cursor)=>
        val decoded=CurrentWire.parse(Exact.string(Base64.getUrlDecoder.decode(cursor.get))).mapObject(_.add("value",bad))
        val token=Base64.getUrlEncoder.withoutPadding().encodeToString(Exact.utf8(decoded.noSpaces))
        cat(f).list(f.identity,q.copy(cursor=Some(token))).attempt.map(r=>assertEquals(r.left.toOption.collect{case e:DomainError=>e.code},Some("bad-envelope")))
      }
    }
    _<-IO(println(s"REVIEW_CURSOR_NEGATIVES pg=$postgres changedOptions=4 invalidTypes=4 expectedBadEnvelope=8"))
  }yield()}}
}
final class IndependentMemoryCatalogueSuite extends IndependentCatalogueContract(false)
final class IndependentPostgresCatalogueSuite extends IndependentCatalogueContract(true)

final class IndependentCatalogueBoundarySuite extends FunSuite {
  override val munitTimeout=90.seconds
  test("actual PG bounded ID/key materialization avoids unrelated malformed manifest hydration") {
    BackendFixture.resource(true).use{f=>
      val names=Vector("cat-a","cat-b","cat-c","unrelated-z")
      val rows=names.zipWithIndex.map{(name,i)=>Artifact(f"${i+1}%032x",name,ArtifactKind.Directory,Visibility.Public,"owner\u0000𐀀","primary",Exact.displayTime(f.clock.now),f.clock.now,None,None,UploadState.Uploading,0,0,0,None,f.clock.now,"[]")}
      val q=wire.CatalogueQuery("cat",true,None,None,wire.CatalogueSort.CreatedByUser,wire.SortDirection.Desc,1,None)
      val selection=CataloguePolicy.prepare(q,f.config.limits,f.clock.now)
      val(sql,params)=CatalogueSql.page(selection)
      for{
        _<-f.metadata.transaction(tx=>rows.foreach(tx.put))
        _<-f.database.get.transaction(c=>Jdbc.exec(c,"UPDATE manure.artifacts SET manifest_json=? WHERE id=?",Array[Byte](-1),Exact.utf8(rows.last.id)))
        actual<-f.metadata.transaction(_.catalogue(selection))
        _<-IO{assertEquals(actual.map(_.name),Vector("cat-c","cat-b"));assertEquals(params.last,2);assert(!sql.contains("OFFSET"));assert(!sql.contains("manifest_json"));assert(sql.contains("WITH page AS MATERIALIZED"))}
        _<-f.database.get.transaction{c=>
          scala.util.Using.resource(c.prepareStatement("EXPLAIN (ANALYZE, VERBOSE, BUFFERS, FORMAT JSON) "+sql)){p=>
            Jdbc.bind(p,params)
            scala.util.Using.resource(p.executeQuery()){rs=>
              assert(rs.next());val text=rs.getString(1);val json=CurrentWire.parse(text)
              def nodes(j:Json):Vector[Json]=Vector(j)++j.hcursor.get[Vector[Json]]("Plans").getOrElse(Vector.empty).flatMap(nodes)
              val tree=json.asArray.get.head.hcursor.downField("Plan").focus.get
              val cte=nodes(tree).find(_.hcursor.get[String]("Subplan Name").toOption.contains("CTE page")).get
              assertEquals(cte.hcursor.get[String]("Node Type").toOption,Some("Limit"))
              assert(cte.hcursor.get[Long]("Actual Rows").toOption.exists(_<=2))
              assert(nodes(cte).forall(j=> !j.hcursor.get[Vector[String]]("Output").getOrElse(Vector.empty).exists(_.contains("manifest_json"))))
              Files.writeString(Path.of(sys.env("MANURE_SOURCE_ROOT")).resolve("catalogue-plan-"+sys.env("REVIEW_RECEIPT_LABEL")+".json"),text)
              println("REVIEW_SQL_BOUND actualHydratedRows="+actual.size+" cteLimitRows="+cte.hcursor.get[Long]("Actual Rows").toOption+" unrelatedInvalidUtf8NotRead=true")
            }
          }
        }
      }yield()
    }.unsafeRunSync()
  }
  test("same admission middleware as Main retains slot through real content body and releases on partial-body finalization") {
    BackendFixture.resource(true).use{f=>
      val cfg=f.config.copy(apiOrigin=ApiOrigin.parse("http://127.0.0.1:47329"),port=47329)
      val engine=new ponygirls.retrieval.postgres.PostgresRetrieval("manure",None)
      val projection=new SearchProjection(cfg,engine)
      val search=new Search(f.database.get,f.lease,cfg,f.auth,f.clock,engine,projection,None)
      val http=new Http(cfg,f.artifacts,new Catalogue(f.artifacts,cfg.limits,f.clock),f.auth,f.clock,search)
      val bytes=Exact.utf8("good")
      for{
        init<-f.artifacts.init(f.identity,InitUpload("body",ArtifactKind.File,Visibility.Public,Vector(ManifestEntry("file.txt",false,4,SecretCodec.sha256(bytes))),None))
        id=init.artifact.id
        _<-f.artifacts.putChunk(f.identity,id,"file.txt",0,bytes,SecretCodec.sha256(bytes))
        _<-f.artifacts.finish(f.identity,id)
        middleware<-org.http4s.server.middleware.MaxActiveRequests.httpApp[IO](1L,http.overloaded)
        app=middleware(http.app)
        request=org.http4s.Request[IO](org.http4s.Method.GET,org.http4s.Uri.unsafeFromString(s"/view/$id/file.txt")).putHeaders(org.http4s.Header.Raw(org.typelevel.ci.CIString("Host"),"127.0.0.1:47329"))
        held<-app.run(request)
        touched<-cats.effect.Ref.of[IO,Boolean](false)
        rejected<-app.run(request.withBodyStream(fs2.Stream.eval(touched.set(true)).drain).putHeaders(org.http4s.Header.Raw(org.typelevel.ci.CIString("Authorization"),"not-a-bearer")))
        rejectedText<-rejected.bodyText.compile.string
        bodyTouched<-touched.get
        _<-IO{
          assertEquals(held.status.code,200);assertEquals(rejected.status.code,503);assert(!bodyTouched)
          assert(rejected.headers.headers.exists(h=>h.name==org.typelevel.ci.CIString("Retry-After")&&h.value=="5"))
          assert(rejected.headers.headers.exists(h=>h.name==org.typelevel.ci.CIString("Connection")&&h.value=="close"))
          assert(rejectedText.contains("unavailable"))
        }
        _<-held.body.take(1).compile.drain
        resumed<-app.run(request)
        result<-resumed.bodyText.compile.string
        _<-IO{assertEquals(resumed.status.code,200);assertEquals(result,"good");println("REVIEW_HTTP_ADMISSION heldResponse200=true second503=true rejectBodyUntouched=true afterPartialFinalize200=true")}
      }yield()
    }.unsafeRunSync()
  }
}
