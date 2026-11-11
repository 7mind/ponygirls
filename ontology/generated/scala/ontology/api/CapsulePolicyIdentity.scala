import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CapsulePolicyIdentity(
    id: String,
    digest: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CapsulePolicyIdentity.baboonDomainVersion
    override def baboonDomainIdentifier: String = CapsulePolicyIdentity.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CapsulePolicyIdentity.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CapsulePolicyIdentity.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CapsulePolicyIdentity.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CapsulePolicyIdentity.baboonMinReaderVersions
  }
  
  object CapsulePolicyIdentity {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CapsulePolicyIdentity"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CapsulePolicyIdentity] = CapsulePolicyIdentity_JsonCodec.instance
  }
  
  object CapsulePolicyIdentity_JsonCodec extends BaboonJsonCodec.BaseGenerated[CapsulePolicyIdentity, BaboonJsonCodec[CapsulePolicyIdentity]] {
    def encode(ctx: BaboonCodecContext, value: CapsulePolicyIdentity): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id),
        "digest" -> Json.fromString(value.digest)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CapsulePolicyIdentity] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeString(v.hcursor))
            digest <- getField(jsonObject, "digest").flatMap(v => decodeString(v.hcursor))
          } yield CapsulePolicyIdentity(id,digest)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CapsulePolicyIdentity: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CapsulePolicyIdentity.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CapsulePolicyIdentity.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CapsulePolicyIdentity.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CapsulePolicyIdentity]] = Lazy(CapsulePolicyIdentity_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CapsulePolicyIdentity]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CapsulePolicyIdentity] = LazyInstance.value
  }
}