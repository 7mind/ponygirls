import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class UploadBase(
    digest: String,
    rawBytes: Long,
    messageCount: Int,
    messageChain: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = UploadBase.baboonDomainVersion
    override def baboonDomainIdentifier: String = UploadBase.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = UploadBase.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = UploadBase.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = UploadBase.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = UploadBase.baboonMinReaderVersions
  }
  
  object UploadBase {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#UploadBase"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[UploadBase] = UploadBase_JsonCodec.instance
  }
  
  object UploadBase_JsonCodec extends BaboonJsonCodec.BaseGenerated[UploadBase, BaboonJsonCodec[UploadBase]] {
    def encode(ctx: BaboonCodecContext, value: UploadBase): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "digest" -> Json.fromString(value.digest),
        "rawBytes" -> Json.fromString(value.rawBytes.toString),
        "messageCount" -> Json.fromInt(value.messageCount),
        "messageChain" -> Json.fromString(value.messageChain)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, UploadBase] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            digest <- getField(jsonObject, "digest").flatMap(v => decodeString(v.hcursor))
            rawBytes <- getField(jsonObject, "rawBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            messageCount <- getField(jsonObject, "messageCount").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            messageChain <- getField(jsonObject, "messageChain").flatMap(v => decodeString(v.hcursor))
          } yield UploadBase(digest,rawBytes,messageCount,messageChain)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to UploadBase: object expected"))
      }
    }
  
    def baboonDomainVersion: String = UploadBase.baboonDomainVersion
    
    def baboonDomainIdentifier: String = UploadBase.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = UploadBase.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[UploadBase]] = Lazy(UploadBase_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[UploadBase]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[UploadBase] = LazyInstance.value
  }
}