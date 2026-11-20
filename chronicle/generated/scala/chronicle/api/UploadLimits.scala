import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class UploadLimits(
    maxPartBytes: Long,
    maxLargePartBytes: Long,
    maxRecordBytes: Long,
    maxRawBytes: Long,
    maxMessages: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = UploadLimits.baboonDomainVersion
    override def baboonDomainIdentifier: String = UploadLimits.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = UploadLimits.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = UploadLimits.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = UploadLimits.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = UploadLimits.baboonMinReaderVersions
  }
  
  object UploadLimits {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#UploadLimits"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[UploadLimits] = UploadLimits_JsonCodec.instance
  }
  
  object UploadLimits_JsonCodec extends BaboonJsonCodec.BaseGenerated[UploadLimits, BaboonJsonCodec[UploadLimits]] {
    def encode(ctx: BaboonCodecContext, value: UploadLimits): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "maxPartBytes" -> Json.fromString(value.maxPartBytes.toString),
        "maxLargePartBytes" -> Json.fromString(value.maxLargePartBytes.toString),
        "maxRecordBytes" -> Json.fromString(value.maxRecordBytes.toString),
        "maxRawBytes" -> Json.fromString(value.maxRawBytes.toString),
        "maxMessages" -> Json.fromInt(value.maxMessages)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, UploadLimits] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            maxPartBytes <- getField(jsonObject, "maxPartBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            maxLargePartBytes <- getField(jsonObject, "maxLargePartBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            maxRecordBytes <- getField(jsonObject, "maxRecordBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            maxRawBytes <- getField(jsonObject, "maxRawBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            maxMessages <- getField(jsonObject, "maxMessages").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield UploadLimits(maxPartBytes,maxLargePartBytes,maxRecordBytes,maxRawBytes,maxMessages)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to UploadLimits: object expected"))
      }
    }
  
    def baboonDomainVersion: String = UploadLimits.baboonDomainVersion
    
    def baboonDomainIdentifier: String = UploadLimits.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = UploadLimits.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[UploadLimits]] = Lazy(UploadLimits_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[UploadLimits]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[UploadLimits] = LazyInstance.value
  }
}