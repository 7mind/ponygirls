import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_7_0 {
  @deprecated("Version 1.7.0 is deprecated, you should migrate to 1.8.0")
  final case class PassagesResult(
    view: ContentView,
    format: PassageFormat,
    passages: List[PassageInfo],
    total: Long,
    offset: Int
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = PassagesResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = PassagesResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = PassagesResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = PassagesResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = PassagesResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = PassagesResult.baboonMinReaderVersions
  }
  
  object PassagesResult {
    def baboonDomainVersion: String = "1.7.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#PassagesResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.7.0", "prefix-compact" -> "1.7.0", "prefix-any-mode" -> "1.7.0", "identical" -> "1.7.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[PassagesResult] = PassagesResult_JsonCodec.instance
  }
  
  @deprecated("Version 1.7.0 is deprecated, you should migrate to 1.8.0")
  object PassagesResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[PassagesResult, BaboonJsonCodec[PassagesResult]] {
    def encode(ctx: BaboonCodecContext, value: PassagesResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "view" -> ContentView_JsonCodec.instance.encode(ctx, value.view),
        "format" -> PassageFormat_JsonCodec.instance.encode(ctx, value.format),
        "passages" -> Json.fromValues(value.passages.map(e => PassageInfo_JsonCodec.instance.encode(ctx, e))),
        "total" -> Json.fromString(value.total.toString),
        "offset" -> Json.fromInt(value.offset)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PassagesResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            view <- getField(jsonObject, "view").flatMap(v => ContentView_JsonCodec.circeDecoder(v.hcursor))
            format <- getField(jsonObject, "format").flatMap(v => PassageFormat_JsonCodec.circeDecoder(v.hcursor))
            passages <- getField(jsonObject, "passages").flatMap(v => decodeList(PassageInfo_JsonCodec.circeDecoder)(v.hcursor))
            total <- getField(jsonObject, "total").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            offset <- getField(jsonObject, "offset").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield PassagesResult(view,format,passages,total,offset)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to PassagesResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = PassagesResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = PassagesResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = PassagesResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PassagesResult]] = Lazy(PassagesResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PassagesResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PassagesResult] = LazyInstance.value
  }
}