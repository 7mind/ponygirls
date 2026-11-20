import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class UploadPart(
    ordinal: Int,
    sha256: String,
    raw: String,
    messages: List[Message]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = UploadPart.baboonDomainVersion
    override def baboonDomainIdentifier: String = UploadPart.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = UploadPart.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = UploadPart.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = UploadPart.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = UploadPart.baboonMinReaderVersions
  }
  
  object UploadPart {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#UploadPart"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[UploadPart] = UploadPart_JsonCodec.instance
  }
  
  object UploadPart_JsonCodec extends BaboonJsonCodec.BaseGenerated[UploadPart, BaboonJsonCodec[UploadPart]] {
    def encode(ctx: BaboonCodecContext, value: UploadPart): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "ordinal" -> Json.fromInt(value.ordinal),
        "sha256" -> Json.fromString(value.sha256),
        "raw" -> Json.fromString(value.raw),
        "messages" -> Json.fromValues(value.messages.map(e => Message_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, UploadPart] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            ordinal <- getField(jsonObject, "ordinal").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            sha256 <- getField(jsonObject, "sha256").flatMap(v => decodeString(v.hcursor))
            raw <- getField(jsonObject, "raw").flatMap(v => decodeString(v.hcursor))
            messages <- getField(jsonObject, "messages").flatMap(v => decodeList(Message_JsonCodec.circeDecoder)(v.hcursor))
          } yield UploadPart(ordinal,sha256,raw,messages)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to UploadPart: object expected"))
      }
    }
  
    def baboonDomainVersion: String = UploadPart.baboonDomainVersion
    
    def baboonDomainIdentifier: String = UploadPart.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = UploadPart.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[UploadPart]] = Lazy(UploadPart_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[UploadPart]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[UploadPart] = LazyInstance.value
  }
}