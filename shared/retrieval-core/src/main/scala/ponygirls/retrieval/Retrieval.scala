package ponygirls.retrieval

import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.time.Instant

/** Safe codes/messages only: never include provider bodies, credentials or indexed content. */
final case class RetrievalError(code: String, detail: String) extends RuntimeException(detail)
object RetrievalChecks {
  def apply(ok: Boolean, code: String, detail: String): Unit = if(!ok) throw RetrievalError(code,detail)
  def hash(text: String): String = MessageDigest.getInstance("SHA-256").digest(text.getBytes(UTF_8)).map(b => f"${b & 255}%02x").mkString
  def text(value: String, maximum: Int): Unit = apply(value.nonEmpty && value.length<=maximum && !value.contains('\u0000') && UTF_8.newEncoder().canEncode(value),"invalid","invalid retrieval identifier/text")
}

final case class EmbeddingSpace(model: String, revision: String, dimensions: Int, sendDimensions: Boolean, queryPrefix: String, documentPrefix: String, normalization: String) {
  def json: Json = Json.arr(Json.fromString("embedding-space-v2"),Json.fromString(model),Json.fromString(revision),Json.fromInt(dimensions),Json.fromBoolean(sendDimensions),Json.fromString(queryPrefix),Json.fromString(documentPrefix),Json.fromString(normalization))
  def id: String = RetrievalChecks.hash(json.noSpaces)
  def validate(): Unit = {
    RetrievalChecks(model.nonEmpty && revision.nonEmpty,"config","immutable embedding model/revision required")
    Vectors.dimensions(dimensions)
    RetrievalChecks(normalization=="cosine","config","unsupported embedding normalization")
  }
}
object EmbeddingSpace {
  def verified(id: String, descriptor: Json): EmbeddingSpace = {
    val values=descriptor.asArray.getOrElse(Vector.empty)
    val legacy=values.headOption.flatMap(_.asString).contains("embedding-space-v1")
    val offset=if(legacy) 2 else 1
    val version=if(legacy) "embedding-space-v1" else "embedding-space-v2"
    RetrievalChecks(values.size==offset+7 && values.head.asString.contains(version) &&
      (!legacy || values(1).asString.exists(_.matches("[0-9a-f]{64}"))) &&
      List(offset,offset+1,offset+4,offset+5,offset+6).forall(i=>values(i).asString.nonEmpty) &&
      values(offset).asString.exists(_.nonEmpty) && values(offset+1).asString.exists(_.nonEmpty) &&
      values(offset+2).asNumber.flatMap(_.toInt).exists(n=>n>=1 && n<=Vectors.maxDimensions) &&
      values(offset+3).asBoolean.nonEmpty && values(offset+6).asString.contains("cosine") &&
      RetrievalChecks.hash(descriptor.noSpaces)==id,"unavailable","embedding space descriptor is unverified")
    EmbeddingSpace(values(offset).asString.get,values(offset+1).asString.get,values(offset+2).asNumber.get.toInt.get,
      values(offset+3).asBoolean.get,values(offset+4).asString.get,values(offset+5).asString.get,values(offset+6).asString.get)
  }
}
final case class RetrievalProfile(space: EmbeddingSpace, policy: String) {
  def id: String = RetrievalChecks.hash(Json.arr(Json.fromString("retrieval-profile-v1"),Json.fromString(space.id),Json.fromString(policy)).noSpaces)
  def validate(): Unit = { space.validate(); RetrievalChecks.text(policy,256) }
}
object Vectors {
  val maxDimensions = 4000
  def dimensions(n: Int): Int = { RetrievalChecks(n>=1 && n<=maxDimensions,"config","indexed embeddings require 1..4000 dimensions"); n }
  def validate(values: List[Double], n: Int): Unit = {
    dimensions(n)
    RetrievalChecks(values.size==n && values.forall(v => v.isFinite && v.toFloat.isFinite) && values.exists(_.toFloat!=0.0f),"invalid","invalid vector dimension/value")
  }
  def sql(values: List[Double], n: Int): String = { validate(values,n); values.mkString("[",",","]") }
  /** Scaled norm avoids overflow for finite original vectors. */
  def cosineDistance(a: List[Double], b: List[Double]): Double = {
    validate(a,a.size); validate(b,a.size)
    def unit(xs: List[Double]): List[Double] = { val scale=xs.map(math.abs).max; val scaled=xs.map(_/scale); val norm=math.sqrt(scaled.map(x => x*x).sum); scaled.map(_/norm) }
    1.0-unit(a).zip(unit(b)).map(_*_).sum.max(-1.0).min(1.0)
  }
}
enum RetrievalMode { case Lexical, Semantic, Hybrid }
enum CountScope { case ExactMatches, CandidateWindow }
object CandidatePolicy {
  val candidatesPerLeg = 1000
  val reciprocalRankConstant = 60
  val efSearch = 200
  val maxScanTuples = 200000
  val scanMemoryMultiplier = 4
  def rankingLimit(mode: RetrievalMode): Int = if(mode==RetrievalMode.Hybrid) candidatesPerLeg*2 else candidatesPerLeg
  def reciprocal(rank: Int): Double = { RetrievalChecks(rank>=1,"invalid","rank must be positive"); 1.0/(reciprocalRankConstant+rank) }
}
final case class AttributeKey private (value: String)
object AttributeKey {
  def parse(value: String): AttributeKey = {
    RetrievalChecks(value.matches("[a-zA-Z][a-zA-Z0-9_.-]{0,127}"),"invalid","invalid projection attribute key")
    new AttributeKey(value)
  }
}
/** Values are stored as bytes, including NUL; never JSONB or lossy normalized metadata. */
final case class AttributeValue(value: String)
final case class ProjectionAttribute(key: AttributeKey,value: AttributeValue)
sealed trait AttributeFilter
object AttributeFilter { final case class Equal(key: AttributeKey,value: AttributeValue) extends AttributeFilter }
/** Exact epoch seconds, including original binary64 expiry represented as a decimal;
  * deliberately NOT a PostgreSQL timestamptz (which rounds to microseconds). */
final case class EpochSeconds(value: BigDecimal)
object EpochSeconds {
  def fromDouble(value: Double): EpochSeconds = {
    RetrievalChecks(value.isFinite,"invalid","non-finite expiry")
    EpochSeconds(BigDecimal(new java.math.BigDecimal(value)))
  }
  def fromInstant(value: Instant): EpochSeconds = EpochSeconds(BigDecimal(value.getEpochSecond)+BigDecimal(value.getNano)/BigDecimal(1000000000))
}
final case class ChunkProvenance(field: String,pointer: Option[String],start: Option[Int],end: Option[Int])
final case class InputChunk(id: String,text: String,provenance: ChunkProvenance)
final case class SourceProjection(id: String,version: String,chunks: List[InputChunk],attributes: Vector[ProjectionAttribute],audience: Set[String],eligible: Boolean,archived: Boolean,expiresAt: Option[EpochSeconds])
final case class RetrievalQuery(principal: String,text: String,mode: RetrievalMode,filters: Vector[AttributeFilter],includeArchived: Boolean,offset: Int,limit: Int,now: EpochSeconds)
final case class RetrievalHit(id: String,version: String,generation: String,profile: Option[String],embeddingSpace: Option[String],chunk: InputChunk,score: Double)
final case class RetrievalPage(hits: List[RetrievalHit],total: Long,countScope: CountScope,rankingLimit: Option[Int])

/** Deterministic original-vector reranking, RRF and best chunk grouping; diagnostic/in-memory reference. */
object Fusion {
  final case class Candidate(id: String,entity: String,lexical: Double,distance: Double)
  final case class Ranked(candidate: Candidate,score: Double)
  def rank(candidates: List[Candidate],mode: RetrievalMode): List[Ranked] = {
    RetrievalChecks(candidates.map(_.id).distinct.size==candidates.size,"invalid","duplicate candidate")
    val lexical=candidates.sortBy(c => (-c.lexical,c.id)).zipWithIndex.map((c,i) => c.id->(i+1)).toMap
    val vector=candidates.sortBy(c => (c.distance,c.id)).zipWithIndex.map((c,i) => c.id->(i+1)).toMap
    val scored=candidates.map { c => Ranked(c,mode match {
      case RetrievalMode.Lexical => c.lexical
      case RetrievalMode.Semantic => 1.0-c.distance
      case RetrievalMode.Hybrid => (if(c.lexical>0) CandidatePolicy.reciprocal(lexical(c.id)) else 0.0)+CandidatePolicy.reciprocal(vector(c.id))
    }) }
    scored.groupBy(_.candidate.entity).values.map(_.sortBy(r => (-r.score,r.candidate.id)).head).toList.sortBy(r => (-r.score,r.candidate.entity))
  }
}
