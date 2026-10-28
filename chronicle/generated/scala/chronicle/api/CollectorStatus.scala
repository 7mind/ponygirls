import io.circe.Decoder.{decodeBoolean, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class CollectorStatus(
    report: CollectorProgressUpdate,
    receivedAt: String,
    stale: Boolean
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CollectorStatus.baboonDomainVersion
    override def baboonDomainIdentifier: String = CollectorStatus.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CollectorStatus.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CollectorStatus.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CollectorStatus.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CollectorStatus.baboonMinReaderVersions
  }
  
  object CollectorStatus {
    def baboonDomainVersion: String = "1.7.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#CollectorStatus"
    private lazy val _baboonSameInVersions: List[String] = List("1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.2.0", "prefix-compact" -> "1.2.0", "prefix-any-mode" -> "1.2.0", "identical" -> "1.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CollectorStatus] = CollectorStatus_JsonCodec.instance
  }
  
  object CollectorStatus_JsonCodec extends BaboonJsonCodec.BaseGenerated[CollectorStatus, BaboonJsonCodec[CollectorStatus]] {
    def encode(ctx: BaboonCodecContext, value: CollectorStatus): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "report" -> CollectorProgressUpdate_JsonCodec.instance.encode(ctx, value.report),
        "receivedAt" -> Json.fromString(value.receivedAt),
        "stale" -> Json.fromBoolean(value.stale)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CollectorStatus] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            report <- getField(jsonObject, "report").flatMap(v => CollectorProgressUpdate_JsonCodec.circeDecoder(v.hcursor))
            receivedAt <- getField(jsonObject, "receivedAt").flatMap(v => decodeString(v.hcursor))
            stale <- getField(jsonObject, "stale").flatMap(v => decodeBoolean(v.hcursor))
          } yield CollectorStatus(report,receivedAt,stale)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CollectorStatus: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CollectorStatus.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CollectorStatus.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CollectorStatus.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CollectorStatus]] = Lazy(CollectorStatus_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CollectorStatus]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CollectorStatus] = LazyInstance.value
  }
}