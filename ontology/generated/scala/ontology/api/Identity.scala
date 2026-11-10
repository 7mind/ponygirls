import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class Identity(
    actor: Actor,
    scopes: List[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Identity.baboonDomainVersion
    override def baboonDomainIdentifier: String = Identity.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Identity.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Identity.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Identity.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Identity.baboonMinReaderVersions
  }
  
  object Identity {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Identity"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Identity] = Identity_JsonCodec.instance
  }
  
  object Identity_JsonCodec extends BaboonJsonCodec.BaseGenerated[Identity, BaboonJsonCodec[Identity]] {
    def encode(ctx: BaboonCodecContext, value: Identity): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "actor" -> Actor_JsonCodec.instance.encode(ctx, value.actor),
        "scopes" -> Json.fromValues(value.scopes.map(e => Json.fromString(e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Identity] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            actor <- getField(jsonObject, "actor").flatMap(v => Actor_JsonCodec.circeDecoder(v.hcursor))
            scopes <- getField(jsonObject, "scopes").flatMap(v => decodeList(decodeString)(v.hcursor))
          } yield Identity(actor,scopes)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Identity: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Identity.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Identity.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Identity.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Identity]] = Lazy(Identity_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Identity]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Identity] = LazyInstance.value
  }
}