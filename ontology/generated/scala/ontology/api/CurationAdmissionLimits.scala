import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CurationAdmissionLimits(
    maxOrdinals: Int,
    maxAuditBytes: Int,
    maxInputBytes: Long,
    maxPins: Int,
    maxLabelChars: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CurationAdmissionLimits.baboonDomainVersion
    override def baboonDomainIdentifier: String = CurationAdmissionLimits.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CurationAdmissionLimits.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CurationAdmissionLimits.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CurationAdmissionLimits.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CurationAdmissionLimits.baboonMinReaderVersions
  }
  
  object CurationAdmissionLimits {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CurationAdmissionLimits"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CurationAdmissionLimits] = CurationAdmissionLimits_JsonCodec.instance
  }
  
  object CurationAdmissionLimits_JsonCodec extends BaboonJsonCodec.BaseGenerated[CurationAdmissionLimits, BaboonJsonCodec[CurationAdmissionLimits]] {
    def encode(ctx: BaboonCodecContext, value: CurationAdmissionLimits): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "maxOrdinals" -> Json.fromInt(value.maxOrdinals),
        "maxAuditBytes" -> Json.fromInt(value.maxAuditBytes),
        "maxInputBytes" -> Json.fromString(value.maxInputBytes.toString),
        "maxPins" -> Json.fromInt(value.maxPins),
        "maxLabelChars" -> Json.fromInt(value.maxLabelChars)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationAdmissionLimits] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            maxOrdinals <- getField(jsonObject, "maxOrdinals").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            maxAuditBytes <- getField(jsonObject, "maxAuditBytes").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            maxInputBytes <- getField(jsonObject, "maxInputBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            maxPins <- getField(jsonObject, "maxPins").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            maxLabelChars <- getField(jsonObject, "maxLabelChars").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield CurationAdmissionLimits(maxOrdinals,maxAuditBytes,maxInputBytes,maxPins,maxLabelChars)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CurationAdmissionLimits: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CurationAdmissionLimits.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CurationAdmissionLimits.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CurationAdmissionLimits.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationAdmissionLimits]] = Lazy(CurationAdmissionLimits_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationAdmissionLimits]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationAdmissionLimits] = LazyInstance.value
  }
}