package haystack.http

import baboon.runtime.shared.{BaboonCodecContext,BaboonJsonCodec}
import haystack.domain.*
import haystack.api
import haystack.retrieval.HaystackRetrieval
import io.circe.Json
import ponygirls.losslessjson.LosslessJson
import ponygirls.retrieval.{RetrievalMode,RetrievalPage}

object Wire {
  val ctx = BaboonCodecContext.Default
  val versions = api.VersionInfo("1.0.0","1.0.0",List("1.0.0"))
  val envelopeLimits = LosslessJson.Limits(3*1024*1024,72,4096,999999)
  def parse(bytes: Array[Byte]): Json = {
    val value=LosslessJson.parseUtf8(bytes,envelopeLimits).fold(_=>throw Fault("bad-envelope","invalid JSON envelope"),value=>value)
    io.circe.parser.parse(LosslessJson.encode(value)).fold(_=>throw Fault("bad-envelope","invalid JSON envelope"),value=>value)
  }
  def encode[A](codec: BaboonJsonCodec[A],value:A):Json=codec.encode(ctx,value)
  def decode[A](codec: BaboonJsonCodec[A],value:Json):A=codec.decode(ctx,value).fold(_=>throw Fault("bad-envelope","invalid current-contract payload"),value=>value)
  def metadata(value:ItemMetadata):api.Metadata=api.Metadata(value.createdAt.toString,value.createdBy,value.modifiedAt.toString,value.modifiedBy)
  def item(value:StoredItem):api.Item=api.Item(value.key.qualified,value.revision.toInt,api.DocumentPayload(value.documentCanonical),metadata(value.metadata))
  def summary(value:haystack.query.SearchSummary):api.Summary=api.Summary(QualifiedId.encodeKey(ItemKey(value.project,value.item)),value.project,value.item,value.revision.toInt,value.title,value.docType,value.status,value.importance,value.humanAttention,value.tags.toList,value.modifiedAt.toString,value.modifiedBy)
  def identity(principal:Principal,activityProjectId:String):api.Identity=api.Identity(principal.userId,principal.userType,principal.tokenId,activityProjectId)
  def retrievalMode(value:api.RetrievalMode):RetrievalMode=value match {
    case api.RetrievalMode.Lexical=>RetrievalMode.Lexical
    case api.RetrievalMode.Semantic=>RetrievalMode.Semantic
    case api.RetrievalMode.Hybrid=>RetrievalMode.Hybrid
  }
  def apiMode(value:RetrievalMode):api.RetrievalMode=value match {
    case RetrievalMode.Lexical=>api.RetrievalMode.Lexical
    case RetrievalMode.Semantic=>api.RetrievalMode.Semantic
    case RetrievalMode.Hybrid=>api.RetrievalMode.Hybrid
  }
  def capabilities(retrieval:HaystackRetrieval):api.RetrievalCapabilities=api.RetrievalCapabilities(retrieval.modes.map(apiMode))
  /** Shared by `/api/v1/retrieve` and the MCP tool: a semantic/hybrid hit must carry the active profile, space and policy. */
  def retrieved(retrieval:HaystackRetrieval,mode:RetrievalMode,page:RetrievalPage):api.RetrieveResult={
    val sources=page.hits.map { hit=>
      val revision=hit.version.takeWhile(_!='/').toInt
      val publishedPolicy=hit.version.dropWhile(_!='/').drop(1)
      if(!publishedPolicy.matches("[0-9a-f]{64}")) throw Fault("unavailable","invalid published projection identity")
      if(mode!=RetrievalMode.Lexical && (!hit.profile.contains(retrieval.store.profile.get.id) || !hit.embeddingSpace.contains(retrieval.store.profile.get.space.id) || publishedPolicy!=retrieval.policy.id)) throw Fault("unavailable","incompatible published profile")
      api.RetrievedSource(hit.id,revision,hit.chunk.provenance.pointer.getOrElse(""),hit.chunk.text,hit.score,hit.generation,hit.profile,hit.embeddingSpace,publishedPolicy,hit.chunk.provenance.field,hit.chunk.provenance.start,hit.chunk.provenance.end)
    }
    api.RetrieveResult(sources,apiMode(mode),page.countScope.toString,page.total,page.rankingLimit,page.pending)
  }
}
