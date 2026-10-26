import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class CollectorStatusResult(
    collectors: List[CollectorStatus]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CollectorStatusResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = CollectorStatusResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CollectorStatusResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CollectorStatusResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CollectorStatusResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CollectorStatusResult.baboonMinReaderVersions
  }
  
  object CollectorStatusResult {
    def baboonDomainVersion: String = "1.4.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#CollectorStatusResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.2.0", "1.3.0", "1.4.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.2.0", "prefix-compact" -> "1.2.0", "prefix-any-mode" -> "1.2.0", "identical" -> "1.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CollectorStatusResult] = CollectorStatusResult_JsonCodec.instance
  }
  
  object CollectorStatusResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[CollectorStatusResult, BaboonJsonCodec[CollectorStatusResult]] {
    def encode(ctx: BaboonCodecContext, value: CollectorStatusResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "collectors" -> Json.fromValues(value.collectors.map(e => CollectorStatus_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CollectorStatusResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            collectors <- getField(jsonObject, "collectors").flatMap(v => decodeList(CollectorStatus_JsonCodec.circeDecoder)(v.hcursor))
          } yield CollectorStatusResult(collectors)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CollectorStatusResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CollectorStatusResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CollectorStatusResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CollectorStatusResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CollectorStatusResult]] = Lazy(CollectorStatusResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CollectorStatusResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CollectorStatusResult] = LazyInstance.value
  }
}