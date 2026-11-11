import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CurationRecordPin(
    ref: Ref,
    digest: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CurationRecordPin.baboonDomainVersion
    override def baboonDomainIdentifier: String = CurationRecordPin.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CurationRecordPin.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CurationRecordPin.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CurationRecordPin.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CurationRecordPin.baboonMinReaderVersions
  }
  
  object CurationRecordPin {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CurationRecordPin"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CurationRecordPin] = CurationRecordPin_JsonCodec.instance
  }
  
  object CurationRecordPin_JsonCodec extends BaboonJsonCodec.BaseGenerated[CurationRecordPin, BaboonJsonCodec[CurationRecordPin]] {
    def encode(ctx: BaboonCodecContext, value: CurationRecordPin): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref),
        "digest" -> Json.fromString(value.digest)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationRecordPin] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            digest <- getField(jsonObject, "digest").flatMap(v => decodeString(v.hcursor))
          } yield CurationRecordPin(ref,digest)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CurationRecordPin: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CurationRecordPin.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CurationRecordPin.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CurationRecordPin.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationRecordPin]] = Lazy(CurationRecordPin_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationRecordPin]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationRecordPin] = LazyInstance.value
  }
}