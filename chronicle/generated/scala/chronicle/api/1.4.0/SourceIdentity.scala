import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_4_0 {
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.8.0")
  final case class SourceIdentity(
    collectorNamespace: String,
    discoveryRootId: String,
    format: SourceFormat,
    producerSessionId: String,
    subagentId: Option[String]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = SourceIdentity.baboonDomainVersion
    override def baboonDomainIdentifier: String = SourceIdentity.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SourceIdentity.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SourceIdentity.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SourceIdentity.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SourceIdentity.baboonMinReaderVersions
  }
  
  object SourceIdentity {
    def baboonDomainVersion: String = "1.4.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#SourceIdentity"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[SourceIdentity] = SourceIdentity_JsonCodec.instance
  }
  
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.8.0")
  object SourceIdentity_JsonCodec extends BaboonJsonCodec.BaseGenerated[SourceIdentity, BaboonJsonCodec[SourceIdentity]] {
    def encode(ctx: BaboonCodecContext, value: SourceIdentity): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "collectorNamespace" -> Json.fromString(value.collectorNamespace),
        "discoveryRootId" -> Json.fromString(value.discoveryRootId),
        "format" -> SourceFormat_JsonCodec.instance.encode(ctx, value.format),
        "producerSessionId" -> Json.fromString(value.producerSessionId),
        "subagentId" -> value.subagentId.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SourceIdentity] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            collectorNamespace <- getField(jsonObject, "collectorNamespace").flatMap(v => decodeString(v.hcursor))
            discoveryRootId <- getField(jsonObject, "discoveryRootId").flatMap(v => decodeString(v.hcursor))
            format <- getField(jsonObject, "format").flatMap(v => SourceFormat_JsonCodec.circeDecoder(v.hcursor))
            producerSessionId <- getField(jsonObject, "producerSessionId").flatMap(v => decodeString(v.hcursor))
            subagentId <- getField(jsonObject, "subagentId").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield SourceIdentity(collectorNamespace,discoveryRootId,format,producerSessionId,subagentId)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SourceIdentity: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SourceIdentity.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SourceIdentity.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SourceIdentity.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SourceIdentity]] = Lazy(SourceIdentity_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SourceIdentity]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SourceIdentity] = LazyInstance.value
  }
}