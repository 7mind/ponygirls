import io.circe.Decoder.{decodeList, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}
import java.util.UUID

package chronicle.api.v1_7_0 {
  @deprecated("Version 1.7.0 is deprecated, you should migrate to 1.8.0")
  final case class PassageInfo(
    id: UUID,
    ordinal: Int,
    summary: String,
    tags: List[String],
    start: PassagePoint,
    `end`: PassagePoint,
    sourceBytes: Long,
    spanCount: Long,
    pieceCount: Long
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = PassageInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = PassageInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = PassageInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = PassageInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = PassageInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = PassageInfo.baboonMinReaderVersions
  }
  
  object PassageInfo {
    def baboonDomainVersion: String = "1.7.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#PassageInfo"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[PassageInfo] = PassageInfo_JsonCodec.instance
  }
  
  @deprecated("Version 1.7.0 is deprecated, you should migrate to 1.8.0")
  object PassageInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[PassageInfo, BaboonJsonCodec[PassageInfo]] {
    def encode(ctx: BaboonCodecContext, value: PassageInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "ordinal" -> Json.fromInt(value.ordinal),
        "summary" -> Json.fromString(value.summary),
        "tags" -> Json.fromValues(value.tags.map(e => Json.fromString(e))),
        "start" -> PassagePoint_JsonCodec.instance.encode(ctx, value.start),
        "end" -> PassagePoint_JsonCodec.instance.encode(ctx, value.`end`),
        "sourceBytes" -> Json.fromString(value.sourceBytes.toString),
        "spanCount" -> Json.fromString(value.spanCount.toString),
        "pieceCount" -> Json.fromString(value.pieceCount.toString)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PassageInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            ordinal <- getField(jsonObject, "ordinal").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            summary <- getField(jsonObject, "summary").flatMap(v => decodeString(v.hcursor))
            tags <- getField(jsonObject, "tags").flatMap(v => decodeList(decodeString)(v.hcursor))
            start <- getField(jsonObject, "start").flatMap(v => PassagePoint_JsonCodec.circeDecoder(v.hcursor))
            `end` <- getField(jsonObject, "end").flatMap(v => PassagePoint_JsonCodec.circeDecoder(v.hcursor))
            sourceBytes <- getField(jsonObject, "sourceBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            spanCount <- getField(jsonObject, "spanCount").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            pieceCount <- getField(jsonObject, "pieceCount").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
          } yield PassageInfo(id,ordinal,summary,tags,start,`end`,sourceBytes,spanCount,pieceCount)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to PassageInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = PassageInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = PassageInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = PassageInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PassageInfo]] = Lazy(PassageInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PassageInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PassageInfo] = LazyInstance.value
  }
}