package haystack.storage

import cats.effect.IO
import cats.syntax.all.*
import haystack.application.ItemService
import haystack.domain.*
import haystack.retrieval.{HaystackRetrieval, ProjectionPolicy}
import io.circe.Json
import ponygirls.retrieval.*
import ponygirls.retrieval.postgres.PostgresRetrieval
import ponygirls.runtime.JdbcDatabase
import java.util.{Random, UUID}
import TestSupport.*

/** Behavioral-Active / Blackbox-GoodCommunication: admitted field keys retain
  * exact provenance through the actual transactional repository and PostgreSQL.
  */
class PointerDomainTest extends ContractSuite {
  private val policy=ProjectionPolicy("synthetic-explicit-all-fields",false,Vector(""),64)
  private val body="pointerdomainneedle exact 🦄 slice"
  private val alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-/~"
  private val wide={
    val random=new Random(0x504f494e544552L)
    Vector.fill(4096)(alphabet.charAt(random.nextInt(alphabet.length))).mkString
  }
  private def pointer(key:String):String="/"+key.replace("~","~0").replace("/","~1")
  private def document(key:String):String=doc("synthetic pointer fixture",Json.obj(key->Json.fromString(body)).noSpaces)
  private def projection(db:JdbcDatabase):HaystackRetrieval=
    new HaystackRetrieval(db,policy,new PostgresRetrieval("pointer-domain-"+UUID.randomUUID(),None),None,16)
  private def ready(f:(JdbcDatabase,PostgresItemRepository,HaystackRetrieval,ItemService)=>IO[Unit]):Unit=
    run(initializedDatabase.use { db=>for{
      retrieval<-IO(projection(db))
      repo=new PostgresItemRepository(db,Some(retrieval))
      _<-repo.initializeProjection()
      service=new ItemService(repo,(_,_)=>IO.unit,IO.pure(Now))
      _<-f(db,repo,retrieval,service)
    }yield() })
  private def exact(retrieval:HaystackRetrieval,field:String,id:String):IO[Unit]=for{
    page<-retrieval.search("pointerdomainneedle",RetrievalMode.Lexical,Some("p"),false,0,20)
    hit=page.hits.find(_.id==id)
    _=assert(hit.nonEmpty,"committed item missing from lexical retrieval")
    _=assertEquals(hit.get.chunk.text,body)
    _=assertEquals(hit.get.chunk.provenance,ChunkProvenance("fields",Some(pointer(field)),Some(0),Some(body.length)))
    filtered<-retrieval.search("pointerdomainneedle",RetrievalMode.Lexical,Some("other-project"),false,0,20)
    _=assert(filtered.hits.isEmpty,"project filter bypassed")
    denied<-retrieval.database.transaction(c=>retrieval.store.search(c,RetrievalQuery("not-authenticated","pointerdomainneedle",RetrievalMode.Lexical,Vector.empty,false,0,20,EpochSeconds.fromInstant(Now)),None))
    _=assert(denied.hits.isEmpty,"retrieval audience filter bypassed")
  }yield()

  test("approved policy and write admission retain a 4096 ASCII field key and exact provenance") {
    run(database.use(db=>IO {
      assert(policy.approved(Vector(wide)))
      val accepted=op(key="p:wide",document=document(wide))
      assert(accepted.document.isRight)
      val item=Mutation.decide(accepted,Alice,Now,None).toOption.get
      val projected=projection(db).project(item)
      assertEquals(projected.chunks.size,1)
      assertEquals(projected.chunks.head.text,body)
      assertEquals(projected.chunks.head.provenance.pointer,Some(pointer(wide)))
      assertEquals(projected.audience,Set("authenticated"))
    }))
  }

  test("short approved key commits and replays with exact content under live retrieval filters") { ready { (_,_,retrieval,service)=>for{
    request<-IO(requestId())
    first<-service.put("p:short",document("public/~literal"),0L,request,Alice)
    _=assert(first.revision==1L && !first.replayed)
    replay<-service.put("p:short",document("public/~literal"),0L,request,Alice)
    _=assert(replay.replayed && replay.revision==1L)
    _<-exact(retrieval,"public/~literal","p:short")
  }yield() } }

  test("approved incompressible 4096 ASCII key PUT and lexical retrieval preserve exact document and pointer") { ready { (_,_,retrieval,service)=>for{
    request<-IO(requestId())
    first<-service.put("p:wide",document(wide),0L,request,Alice)
    _=assert(first.revision==1L && !first.replayed)
    _<-exact(retrieval,wide,"p:wide")
    read<-service.get("p:wide",None)
    _=assertEquals(read.documentCanonical,op(key="p:wide",document=document(wide)).documentCanonical)
    replay<-service.put("p:wide",document(wide),0L,request,Alice)
    _=assert(replay.replayed && replay.revision==1L)
  }yield() } }

  test("startup rebuilds a previous identity policy without changing authoritative revision history or replay") { ready { (db,repo,retrieval,_)=>
    val operation=op(key="p:upgrade",document=document("public/~literal"))
    val plain=new PostgresItemRepository(db,None)
    val oldPolicy=RetrievalChecks.hash(Json.arr(Json.fromString("haystack-projection-v1"),Json.fromString(policy.name),Json.fromBoolean(policy.includeMetadata),Json.arr(policy.approvedFieldPrefixes.map(Json.fromString)*),Json.fromInt(policy.maxChunkBytes)).noSpaces)
    for{
      first<-plain.commit(operation,Alice,Now)
      item<-plain.current(operation.key).map(_.get)
      history<-plain.history(operation.key)
      legacy=retrieval.project(item).copy(version=s"1/$oldPolicy",chunks=retrieval.project(item).chunks.map(ch=>ch.copy(id=s"${ch.provenance.field}:${ch.provenance.pointer.get}:${ch.provenance.start.get}")))
      _<-db.transaction(c=>retrieval.store.put(c,legacy))
      _<-repo.initializeProjection()
      _<-exact(retrieval,"public/~literal","p:upgrade")
      page<-retrieval.search("pointerdomainneedle",RetrievalMode.Lexical,Some("p"),false,0,20)
      _=assertEquals(page.hits.head.version,s"1/${policy.id}")
      _=assertNotEquals(page.hits.head.version,legacy.version)
      after<-repo.current(operation.key)
      _=assertEquals(after.map(v=>(v.key,v.revision,v.documentCanonical,v.metadata)),Some((item.key,item.revision,item.documentCanonical,item.metadata)))
      afterHistory<-repo.history(operation.key)
      _=assertEquals(afterHistory,history)
      replay<-repo.commit(operation,Alice,Later)
      _=assertEquals(replay,first.copy(replayed=true))
    }yield()
  } }
}
