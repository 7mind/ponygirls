package haystack.storage

import cats.effect.IO
import cats.syntax.all.*
import haystack.Config
import haystack.application.ItemService
import haystack.auth.{Auth,Tokens}
import haystack.domain.*
import haystack.retrieval.HaystackRetrieval
import ponygirls.retrieval.*
import ponygirls.retrieval.postgres.PostgresRetrieval
import ponygirls.runtime.JdbcFailure
import io.circe.Json
import java.nio.file.{Files,Path}
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.sql.SQLException
import java.util.Random
import TestSupport.*

/** Accepted-domain regression probe: Behavioral-Active Blackbox/GoodCommunication.
  * Actual ItemService/repository/retrieval composition and owned least-privilege
  * PostgreSQL; no embedding provider and no replacement/mock JDBC implementation.
  */
class PointerDomainTest extends ContractSuite {
  private val marker=Path.of(sys.env.getOrElse("HAYSTACK_POINTER_OWNED_MARKER",throw new IllegalStateException("owned pointer fixture marker required")))
  private val owned=io.circe.parser.parse(Files.readString(marker)).toOption.get.hcursor
  private val config=Config.load(Path.of(sys.env("HAYSTACK_POINTER_CONFIG")))
  require(owned.get[String]("kind").contains("owned-haystack-pointer-domain"))
  require(owned.get[String]("jdbcUrl").contains(config.database.jdbcUrl))
  require(owned.get[String]("user").contains(config.database.user))
  require(config.database==databaseConfig)
  private val auth=Auth.load(config.auth)
  private val principal=auth.authenticate(sys.env("HAYSTACK_POINTER_SYNTHETIC_TOKEN")).get
  private val body="pointerdomainneedle exact 🦄 slice"
  private val random=new Random(0x504f494e544552L)
  private val alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-/~"
  private val wide=Vector.fill(4096)(alphabet.charAt(random.nextInt(alphabet.length))).mkString
  private def pointer(key:String):String="/"+key.replace("~","~0").replace("/","~1")
  private def document(key:String):String=doc("synthetic pointer fixture",Json.obj(key->Json.fromString(body)).noSpaces)
  private def operation(id:String,key:String):AcceptedOperation=op(key=id,document=document(key))
  private def stored(accepted:AcceptedOperation):StoredItem=Mutation.decide(accepted,principal,Now,None).toOption.get
  private def projection(db:ponygirls.runtime.JdbcDatabase):HaystackRetrieval=
    new HaystackRetrieval(db,config.retrieval.policy,new PostgresRetrieval("haystack",None),None,config.retrieval.batchSize)
  private def ready[A](f:(ponygirls.runtime.JdbcDatabase,PostgresItemRepository,HaystackRetrieval,ItemService)=>IO[A]):A=run(database.use { db=>for{
    _<-Migrations.initialize(db,config.auth.activityProjectId)
    retrieval=projection(db)
    repo=new PostgresItemRepository(db,Some(retrieval))
    _<-repo.initializeProjection()
    service=new ItemService(repo,(_,_)=>IO.unit,IO.pure(Now))
    role<-db.transaction(c=>Sql.rows(c,"SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user")(r=>Vector(r.getBoolean(1),r.getBoolean(2),r.getBoolean(3),r.getBoolean(4))).head)
    _=assert(role.forall(value=> !value),"fixture role must not have administrative capabilities")
    value<-f(db,repo,retrieval,service)
  }yield value })
  private def exact(retrieval:HaystackRetrieval,field:String,id:String):IO[Unit]=for{
    page<-retrieval.search("pointerdomainneedle",RetrievalMode.Lexical,Some("p"),false,0,20)
    hit=page.hits.find(_.id==id)
    _=assert(hit.nonEmpty,"committed item missing from lexical retrieval")
    _=assert(hit.get.chunk.text==body,"chunk body changed")
    _=assert(hit.get.chunk.provenance==ChunkProvenance("fields",Some(pointer(field)),Some(0),Some(body.length)),"exact pointer/field/UTF16 coordinates changed (values suppressed)")
    filtered<-retrieval.search("pointerdomainneedle",RetrievalMode.Lexical,Some("other-project"),false,0,20)
    _=assert(filtered.hits.isEmpty,"project eligibility filter bypassed")
    denied<-retrieval.database.transaction(c=>retrieval.store.search(c,RetrievalQuery("not-authenticated","pointerdomainneedle",RetrievalMode.Lexical,Vector.empty,false,0,20,EpochSeconds.fromInstant(Now)),None))
    _=assert(denied.hits.isEmpty,"retrieval audience filter bypassed")
  }yield()

  test("current config and write admission accept an approved 4096 ASCII key without changing provenance") { run(database.use { db=>IO {
    assertEquals(config.retrieval.policy.approvedFieldPrefixes,Vector(""))
    assert(!config.retrieval.policy.includeMetadata && config.retrieval.embedding.isEmpty)
    assert(config.retrieval.policy.approved(Vector(wide)))
    val accepted=operation("p:wide",wide)
    assert(accepted.document.isRight,"wide object key must be admitted under the current documented bounds")
    val projected=projection(db).project(stored(accepted))
    assert(projected.chunks.size==1 && projected.chunks.head.text==body)
    assert(projected.chunks.head.provenance.pointer.contains(pointer(wide)),"projection lost exact RFC6901 pointer")
    assertEquals(projected.audience,Set("authenticated"))
    val hash=MessageDigest.getInstance("SHA-256").digest(wide.getBytes(UTF_8)).map(b=>f"${b & 255}%02x").mkString
    println(Json.obj("kind"->Json.fromString("haystack-pointer-admission"),"configAccepted"->Json.True,"documentAccepted"->Json.True,"keyBytes"->Json.fromInt(wide.getBytes(UTF_8).length),"keySha256"->Json.fromString(hash),"pointerBytes"->Json.fromInt(pointer(wide).getBytes(UTF_8).length),"chunkIdBytes"->Json.fromInt(projected.chunks.head.id.getBytes(UTF_8).length),"bodyBytes"->Json.fromInt(body.getBytes(UTF_8).length)).noSpaces)
  }}) }

  test("short approved key commits through ItemService and retrieves exact content under live ACL filters") { ready { (_,_,retrieval,service)=>for{
    request<-IO(requestId())
    first<-service.put("p:short",document("public/~literal"),0L,request,principal)
    _=assert(first.revision==1L && !first.replayed)
    replay<-service.put("p:short",document("public/~literal"),0L,request,principal)
    _=assert(replay.replayed && replay.revision==1L)
    _<-exact(retrieval,"public/~literal","p:short")
  }yield() } }

  test("approved incompressible 4096 ASCII field key PUT and lexical retrieval preserve exact provenance") { ready { (db,repo,retrieval,service)=>
    val accepted=operation("p:wide",wide)
    service.put("p:wide",document(wide),0L,accepted.requestId,principal).attempt.flatMap {
      case Right(result)=>for{
        _<-IO(assertEquals(result.revision,1L))
        _<-exact(retrieval,wide,"p:wide")
        read<-service.get("p:wide",None)
        _=assert(read.documentCanonical==accepted.documentCanonical,"authoritative document changed (values suppressed)")
      }yield()
      case Left(error)=>for{
        current<-repo.current(accepted.key)
        history<-repo.history(accepted.key)
        _=assert(current.isEmpty && history.isEmpty,"failed projection must roll back authoritative item/history")
        _<-IO(println(Json.obj("kind"->Json.fromString("haystack-pointer-service-failure"),"class"->Json.fromString(error.getClass.getName),"sqlState"->Json.fromString(error match{case s:SQLException=>Option(s.getSQLState).getOrElse("none");case _=>"none"}),"itemAndHistoryRolledBack"->Json.True).noSpaces))
        _<-db.transaction { c=>
          try retrieval.put(c,stored(accepted))
          catch {case raw:SQLException=>
            println(Json.obj("kind"->Json.fromString("haystack-pointer-actual-adapter-driver"),"class"->Json.fromString(raw.getClass.getName),"sqlState"->Json.fromString(Option(raw.getSQLState).getOrElse("none"))).noSpaces)
            throw raw
          }
        }.attempt
        _<-IO.raiseError[Unit](error)
      }yield()
    }
  } }
}
