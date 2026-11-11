import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CurationSourcePin(
    ref: Ref,
    frontier: Long,
    digest: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CurationSourcePin.baboonDomainVersion
    override def baboonDomainIdentifier: String = CurationSourcePin.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CurationSourcePin.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CurationSourcePin.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CurationSourcePin.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CurationSourcePin.baboonMinReaderVersions
  }
  
  object CurationSourcePin {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CurationSourcePin"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CurationSourcePin] = CurationSourcePin_JsonCodec.instance
  }
  
  object CurationSourcePin_JsonCodec extends BaboonJsonCodec.BaseGenerated[CurationSourcePin, BaboonJsonCodec[CurationSourcePin]] {
    def encode(ctx: BaboonCodecContext, value: CurationSourcePin): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref),
        "frontier" -> Json.fromString(value.frontier.toString),
        "digest" -> Json.fromString(value.digest)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationSourcePin] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            digest <- getField(jsonObject, "digest").flatMap(v => decodeString(v.hcursor))
          } yield CurationSourcePin(ref,frontier,digest)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CurationSourcePin: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CurationSourcePin.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CurationSourcePin.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CurationSourcePin.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationSourcePin]] = Lazy(CurationSourcePin_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationSourcePin]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationSourcePin] = LazyInstance.value
  }
}