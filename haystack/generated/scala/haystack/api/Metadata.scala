import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class Metadata(
    createdAt: String,
    createdBy: String,
    modifiedAt: String,
    modifiedBy: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Metadata.baboonDomainVersion
    override def baboonDomainIdentifier: String = Metadata.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Metadata.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Metadata.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Metadata.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Metadata.baboonMinReaderVersions
  }
  
  object Metadata {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#Metadata"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Metadata] = Metadata_JsonCodec.instance
  }
  
  object Metadata_JsonCodec extends BaboonJsonCodec.BaseGenerated[Metadata, BaboonJsonCodec[Metadata]] {
    def encode(ctx: BaboonCodecContext, value: Metadata): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "createdAt" -> Json.fromString(value.createdAt),
        "createdBy" -> Json.fromString(value.createdBy),
        "modifiedAt" -> Json.fromString(value.modifiedAt),
        "modifiedBy" -> Json.fromString(value.modifiedBy)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Metadata] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            createdAt <- getField(jsonObject, "createdAt").flatMap(v => decodeString(v.hcursor))
            createdBy <- getField(jsonObject, "createdBy").flatMap(v => decodeString(v.hcursor))
            modifiedAt <- getField(jsonObject, "modifiedAt").flatMap(v => decodeString(v.hcursor))
            modifiedBy <- getField(jsonObject, "modifiedBy").flatMap(v => decodeString(v.hcursor))
          } yield Metadata(createdAt,createdBy,modifiedAt,modifiedBy)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Metadata: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Metadata.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Metadata.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Metadata.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Metadata]] = Lazy(Metadata_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Metadata]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Metadata] = LazyInstance.value
  }
}