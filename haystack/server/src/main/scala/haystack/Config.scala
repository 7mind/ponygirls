package haystack

import haystack.auth.*
import haystack.domain.Fault
import haystack.retrieval.ProjectionPolicy
import ponygirls.runtime.{JdbcConfig,JdbcLimits}
import ponygirls.retrieval.EmbeddingEndpoint
import io.circe.{Json,HCursor}
import java.nio.file.{Files,Path}
import scala.concurrent.duration.*

final case class RetrievalConfig(policy:ProjectionPolicy,embedding:Option[EmbeddingEndpoint],maxConcurrent:Int,maxQueued:Int,batchSize:Int)
final case class Config(listenHost:String,listenPort:Int,webRoot:Option[Path],authReloadMs:Int,auth:AuthConfig,database:JdbcConfig,retrieval:RetrievalConfig)
object Config {
  private def fail():Nothing=throw Fault("config","invalid service configuration")
  private def expand(raw:String):String={
    val prefix="$CREDENTIALS_DIRECTORY/"
    if(!raw.startsWith(prefix))raw
    else sys.env.get("CREDENTIALS_DIRECTORY").fold(fail())(_+"/"+raw.drop(prefix.length))
  }
  def load(path:Path):Config={
    val stream=Files.newInputStream(path)
    val bytes=try stream.readNBytes(1024*1024+1) finally stream.close()
    if(bytes.length>1024*1024)fail()
    val c=haystack.http.Wire.parse(bytes).hcursor
    def get[A:io.circe.Decoder](cursor:HCursor,key:String):A=cursor.get[A](key).fold(_=>fail(),identity)
    def number[A:io.circe.Decoder](cursor:HCursor,key:String):A={if(!cursor.downField(key).focus.exists(_.isNumber))fail();get[A](cursor,key)}
    def child(cursor:HCursor,key:String):HCursor=cursor.downField(key).success.getOrElse(fail())
    def duration(cursor:HCursor,key:String):FiniteDuration={val n=number[Long](cursor,key);if(n<1||n>3600000)fail();n.millis}
    val a=child(c,"auth")
    val users=get[Vector[Json]](a,"users").map { raw=>val u=raw.hcursor
      UserConfig(get[String](u,"id"),get[String](u,"type"),get[String](u,"displayName"),get[Vector[Json]](u,"tokens").map{ raw=>val t=raw.hcursor;TokenConfig(get[String](t,"id"),expand(get[String](t,"hashFile")))})
    }
    val rate=get[Option[Json]](a,"rateLimit").map {raw=>val r=raw.hcursor;RateLimit(number[Long](r,"windowMs"),number[Int](r,"max"))}
    val auth=AuthConfig(get[String](a,"activityProjectId"),users,get[Boolean](a,"cookieSecure"),get[Vector[String]](a,"allowedHosts"),get[Vector[String]](a,"allowedOrigins"),get[Vector[String]](a,"insecureHttpOrigins"),rate)
    val d=child(c,"database");val l=child(d,"limits")
    val db=JdbcConfig(get[String](d,"jdbcUrl"),get[String](d,"user"),Path.of(expand(get[String](d,"passwordFile"))),JdbcLimits(number[Int](l,"maxConnections"),number[Int](l,"maxQueued"),duration(l,"queueTimeoutMs"),duration(l,"connectTimeoutMs"),duration(l,"statementTimeoutMs"),duration(l,"lockTimeoutMs"),duration(l,"idleTransactionTimeoutMs"),duration(l,"socketTimeoutMs")))
    db.validate()
    val r=child(c,"retrieval")
    val policy=ProjectionPolicy(get[String](r,"policy"),get[Boolean](r,"includeMetadata"),get[Vector[String]](r,"approvedFieldPrefixes"),number[Int](r,"maxChunkBytes"))
    val embedding=get[Option[Json]](r,"embedding").map {raw=>val e=raw.hcursor
      EmbeddingEndpoint(get[String](e,"operationUrl"),get[String](e,"model"),get[String](e,"revision"),number[Int](e,"dimensions"),get[Boolean](e,"sendDimensions"),get[String](e,"documentPrefix"),get[String](e,"queryPrefix"),get[String](e,"normalization"),expand(get[String](e,"credentialFile")),duration(e,"deadlineMs"),number[Int](e,"maxResponseBytes"),number[Int](e,"maxBatch"),number[Int](e,"maxInputBytes"),number[Int](e,"maxRequestBytes"))
    }
    embedding.foreach(_.validate())
    val concurrent=number[Int](r,"maxConcurrent");val queued=number[Int](r,"maxQueued");val batch=number[Int](r,"batchSize")
    if(concurrent<1||concurrent>32||queued<0||queued>1024||batch<1||batch>1024)fail()
    embedding.foreach { e=>
      if(batch>e.maxBatch || policy.maxChunkBytes+e.documentPrefix.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>e.maxInputBytes)fail()
    }
    val host=get[String](c,"listenHost");val port=number[Int](c,"listenPort");val reload=number[Int](c,"authReloadMs")
    if(host.isEmpty||port<1||port>65535||reload<100||reload>60000)fail()
    Config(host,port,get[Option[String]](c,"webRoot").map(Path.of(_)),reload,auth,db,RetrievalConfig(policy,embedding,concurrent,queued,batch))
  }
}
