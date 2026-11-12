import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CapsuleLimits(
    maxRecords: Int,
    maxPayloadBytes: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CapsuleLimits.baboonDomainVersion
    override def baboonDomainIdentifier: String = CapsuleLimits.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CapsuleLimits.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CapsuleLimits.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CapsuleLimits.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CapsuleLimits.baboonMinReaderVersions
  }
  
  object CapsuleLimits {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CapsuleLimits"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CapsuleLimits] = CapsuleLimits_JsonCodec.instance
  }
  
  object CapsuleLimits_JsonCodec extends BaboonJsonCodec.BaseGenerated[CapsuleLimits, BaboonJsonCodec[CapsuleLimits]] {
    def encode(ctx: BaboonCodecContext, value: CapsuleLimits): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "maxRecords" -> Json.fromInt(value.maxRecords),
        "maxPayloadBytes" -> Json.fromInt(value.maxPayloadBytes)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CapsuleLimits] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            maxRecords <- getField(jsonObject, "maxRecords").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            maxPayloadBytes <- getField(jsonObject, "maxPayloadBytes").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield CapsuleLimits(maxRecords,maxPayloadBytes)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CapsuleLimits: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CapsuleLimits.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CapsuleLimits.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CapsuleLimits.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CapsuleLimits]] = Lazy(CapsuleLimits_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CapsuleLimits]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CapsuleLimits] = LazyInstance.value
  }
}