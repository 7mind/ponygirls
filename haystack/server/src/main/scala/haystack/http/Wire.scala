package haystack.http

import baboon.runtime.shared.{BaboonCodecContext,BaboonJsonCodec}
import haystack.domain.*
import haystack.api
import io.circe.Json
import ponygirls.losslessjson.LosslessJson

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
}
