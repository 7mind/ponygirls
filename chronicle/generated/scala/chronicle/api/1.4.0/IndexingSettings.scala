import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_4_0 {
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.8.0")
  final case class IndexingSettings(
    annotationSessions: Int,
    embeddingRequests: Int,
    embeddingBatchSize: Int
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = IndexingSettings.baboonDomainVersion
    override def baboonDomainIdentifier: String = IndexingSettings.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = IndexingSettings.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = IndexingSettings.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = IndexingSettings.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = IndexingSettings.baboonMinReaderVersions
  }
  
  object IndexingSettings {
    def baboonDomainVersion: String = "1.4.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#IndexingSettings"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[IndexingSettings] = IndexingSettings_JsonCodec.instance
  }
  
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.8.0")
  object IndexingSettings_JsonCodec extends BaboonJsonCodec.BaseGenerated[IndexingSettings, BaboonJsonCodec[IndexingSettings]] {
    def encode(ctx: BaboonCodecContext, value: IndexingSettings): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "annotationSessions" -> Json.fromInt(value.annotationSessions),
        "embeddingRequests" -> Json.fromInt(value.embeddingRequests),
        "embeddingBatchSize" -> Json.fromInt(value.embeddingBatchSize)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, IndexingSettings] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            annotationSessions <- getField(jsonObject, "annotationSessions").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            embeddingRequests <- getField(jsonObject, "embeddingRequests").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            embeddingBatchSize <- getField(jsonObject, "embeddingBatchSize").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield IndexingSettings(annotationSessions,embeddingRequests,embeddingBatchSize)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to IndexingSettings: object expected"))
      }
    }
  
    def baboonDomainVersion: String = IndexingSettings.baboonDomainVersion
    
    def baboonDomainIdentifier: String = IndexingSettings.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = IndexingSettings.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[IndexingSettings]] = Lazy(IndexingSettings_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[IndexingSettings]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[IndexingSettings] = LazyInstance.value
  }
}