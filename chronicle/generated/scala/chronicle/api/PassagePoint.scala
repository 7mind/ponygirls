import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class PassagePoint(
    messageId: String,
    messagePosition: Int,
    byteOffset: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = PassagePoint.baboonDomainVersion
    override def baboonDomainIdentifier: String = PassagePoint.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = PassagePoint.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = PassagePoint.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = PassagePoint.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = PassagePoint.baboonMinReaderVersions
  }
  
  object PassagePoint {
    def baboonDomainVersion: String = "1.8.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#PassagePoint"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[PassagePoint] = PassagePoint_JsonCodec.instance
  }
  
  object PassagePoint_JsonCodec extends BaboonJsonCodec.BaseGenerated[PassagePoint, BaboonJsonCodec[PassagePoint]] {
    def encode(ctx: BaboonCodecContext, value: PassagePoint): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "messageId" -> Json.fromString(value.messageId),
        "messagePosition" -> Json.fromInt(value.messagePosition),
        "byteOffset" -> Json.fromInt(value.byteOffset)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PassagePoint] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            messageId <- getField(jsonObject, "messageId").flatMap(v => decodeString(v.hcursor))
            messagePosition <- getField(jsonObject, "messagePosition").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            byteOffset <- getField(jsonObject, "byteOffset").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield PassagePoint(messageId,messagePosition,byteOffset)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to PassagePoint: object expected"))
      }
    }
  
    def baboonDomainVersion: String = PassagePoint.baboonDomainVersion
    
    def baboonDomainIdentifier: String = PassagePoint.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = PassagePoint.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PassagePoint]] = Lazy(PassagePoint_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PassagePoint]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PassagePoint] = LazyInstance.value
  }
}