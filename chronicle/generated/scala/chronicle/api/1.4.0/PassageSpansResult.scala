import io.circe.Decoder.{decodeList, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}
import java.util.UUID

package chronicle.api.v1_4_0 {
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.7.0")
  final case class PassageSpansResult(
    view: ContentView,
    passageId: UUID,
    spans: List[PassageSourceSpan],
    total: Long,
    offset: Int
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = PassageSpansResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = PassageSpansResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = PassageSpansResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = PassageSpansResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = PassageSpansResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = PassageSpansResult.baboonMinReaderVersions
  }
  
  object PassageSpansResult {
    def baboonDomainVersion: String = "1.4.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#PassageSpansResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[PassageSpansResult] = PassageSpansResult_JsonCodec.instance
  }
  
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.7.0")
  object PassageSpansResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[PassageSpansResult, BaboonJsonCodec[PassageSpansResult]] {
    def encode(ctx: BaboonCodecContext, value: PassageSpansResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "view" -> ContentView_JsonCodec.instance.encode(ctx, value.view),
        "passageId" -> Json.fromString(value.passageId.toString()),
        "spans" -> Json.fromValues(value.spans.map(e => PassageSourceSpan_JsonCodec.instance.encode(ctx, e))),
        "total" -> Json.fromString(value.total.toString),
        "offset" -> Json.fromInt(value.offset)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PassageSpansResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            view <- getField(jsonObject, "view").flatMap(v => ContentView_JsonCodec.circeDecoder(v.hcursor))
            passageId <- getField(jsonObject, "passageId").flatMap(v => decodeUUID(v.hcursor))
            spans <- getField(jsonObject, "spans").flatMap(v => decodeList(PassageSourceSpan_JsonCodec.circeDecoder)(v.hcursor))
            total <- getField(jsonObject, "total").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            offset <- getField(jsonObject, "offset").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield PassageSpansResult(view,passageId,spans,total,offset)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to PassageSpansResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = PassageSpansResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = PassageSpansResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = PassageSpansResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PassageSpansResult]] = Lazy(PassageSpansResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PassageSpansResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PassageSpansResult] = LazyInstance.value
  }
}