package haystack.retrieval

import cats.effect.IO
import cats.syntax.all.*
import haystack.domain.*
import ponygirls.losslessjson.LosslessJson
import ponygirls.retrieval.*
import ponygirls.retrieval.postgres.{PostgresRetrieval,WorkClaim}
import ponygirls.runtime.JdbcDatabase
import java.sql.Connection
import java.time.Instant
import scala.concurrent.duration.*

/** Operator-approved corpus. Pointer prefixes are decoded RFC6901 components,
  * not string prefix guesses. Empty prefix explicitly approves all string leaves.
  * Numbers/booleans/null/credentials are never inferred as searchable text. */
final case class ProjectionPolicy(name:String,includeMetadata:Boolean,approvedFieldPrefixes:Vector[String],maxChunkBytes:Int) {
  private def decode(raw:String):Vector[String]={
    if(raw=="") Vector.empty
    else if(!raw.startsWith("/") || "~(?![01])".r.findFirstIn(raw).nonEmpty) throw Fault("config","invalid approved field pointer")
    else raw.drop(1).split("/",-1).toVector.map(_.replace("~1","/").replace("~0","~"))
  }
  val prefixes:Vector[Vector[String]]=approvedFieldPrefixes.map(decode)
  if(name.isEmpty || maxChunkBytes<4 || maxChunkBytes>256*1024 || approvedFieldPrefixes.distinct.size!=approvedFieldPrefixes.size) throw Fault("config","invalid projection policy")
  val id:String=RetrievalChecks.hash(io.circe.Json.arr(io.circe.Json.fromString("haystack-projection-v1"),io.circe.Json.fromString(name),io.circe.Json.fromBoolean(includeMetadata),io.circe.Json.arr(approvedFieldPrefixes.map(io.circe.Json.fromString)*),io.circe.Json.fromInt(maxChunkBytes)).noSpaces)
  def approved(path:Vector[String]):Boolean=prefixes.exists(prefix=>path.startsWith(prefix))
}

final class HaystackRetrieval(val database:JdbcDatabase,val policy:ProjectionPolicy,val store:PostgresRetrieval,val embedding:Option[EmbeddingClient],val batchSize:Int) {
  private def pointer(parts:Vector[String]):String=parts.map(_.replace("~","~0").replace("/","~1")).mkString("/","/","")
  private def chunks(field:String,ptr:String,text:String):List[InputChunk]={
    val out=List.newBuilder[InputChunk];var start=0;var at=0;var bytes=0
    while(at<text.length){
      val cp=text.codePointAt(at);val length=Character.charCount(cp);val width=if(cp<128)1 else if(cp<2048)2 else if(cp<65536)3 else 4
      if(bytes+width>policy.maxChunkBytes && at>start){out+=InputChunk(s"$field:$ptr:$start",text.substring(start,at),ChunkProvenance(field,Some(ptr),Some(start),Some(at)));start=at;bytes=0}
      at+=length;bytes+=width
    }
    if(at>start)out+=InputChunk(s"$field:$ptr:$start",text.substring(start,at),ChunkProvenance(field,Some(ptr),Some(start),Some(at)))
    out.result()
  }
  def project(item:StoredItem):SourceProjection={
    val d=item.document;val out=List.newBuilder[InputChunk]
    if(policy.includeMetadata){
      out++=chunks("title","/title",d.title);out++=chunks("description","/description",d.description)
      d.tags.zipWithIndex.foreach((tag,i)=>out++=chunks("tags",s"/tags/$i",tag))
    }
    def leaves(value:LosslessJson.Value,path:Vector[String]):Unit=value match{
      case s:LosslessJson.Str if policy.approved(path)=>out++=chunks("fields",if(path.isEmpty)"" else pointer(path),s.value)
      case a:LosslessJson.Arr=>a.values.zipWithIndex.foreach((v,i)=>leaves(v,path:+i.toString))
      case o:LosslessJson.Obj=>o.fields.foreach((key,v)=>leaves(v,path:+key))
      case _=>()
    }
    leaves(d.fields,Vector.empty)
    val attrs=Vector("project"->item.key.project,"type"->d.docType,"status"->d.status,"importance"->d.importance,"human-attention"->d.humanAttention).map((k,v)=>ProjectionAttribute(AttributeKey.parse(k),AttributeValue(v)))
    SourceProjection(item.key.qualified,s"${item.revision}/${policy.id}",out.result(),attrs,Set("authenticated"),true,d.status=="archived",None)
  }
  def put(c:Connection,item:StoredItem):Unit=store.put(c,project(item))
  def initialize(items:Vector[StoredItem]):IO[Unit]=database.transaction{ c=>store.initialize(c);items.foreach(put(c,_)) }
  def search(text:String,mode:RetrievalMode,project:Option[String],includeArchived:Boolean,offset:Int,limit:Int):IO[RetrievalPage]=for{
    now<-IO.realTimeInstant
    query=RetrievalQuery("authenticated",text,mode,project.toVector.map(p=>AttributeFilter.Equal(AttributeKey.parse("project"),AttributeValue(p))),includeArchived,offset,limit,EpochSeconds.fromInstant(now))
    vector<-if(mode==RetrievalMode.Lexical) IO.pure(None) else embedding.fold(IO.raiseError[Option[List[Double]]](Fault("unavailable","semantic retrieval is not configured; lexical-only capability")))(_.query(text).map(Some(_)))
    page<-database.transaction(c=>store.search(c,query,vector))
    // Fresh delivery-time eligibility/ACL check, preserving immutable hit version.
    visible<-database.transaction(c=>page.hits.filter(hit=>store.visible(c,query,hit.id)))
  }yield page.copy(hits=visible)
  def run:IO[Nothing]=embedding match{
    case None=>IO.never
    case Some(client)=>
      def execute(claim:WorkClaim):IO[Unit]={
        val batches=claim.chunks.grouped(batchSize).toList.zipWithIndex
        batches.traverse_ { (group,index)=>
          val first=index*batchSize
          for{
            _<-database.transaction(c=>store.renew(c,claim,120))
            accepted<-database.transaction(c=>store.accepted(c,claim,first,group.size))
            _<-accepted match{
              case Some(_)=>IO.unit
              case None=>client.documents(group.map(_.text)).flatMap(v=>database.transaction(c=>store.accept(c,claim,first,v)))
            }
          }yield()
        } *> database.transaction(c=>store.publish(c,claim)).void
      }
      def step:IO[Unit]=database.transaction(c=>store.claim(c,120)).flatMap{
        case None=>IO.sleep(500.millis)
        case Some(claim)=>execute(claim).handleErrorWith(_=>database.transaction(c=>store.fail(c,claim)).handleErrorWith(_=>IO.unit))
      }
      step.foreverM
  }
}
