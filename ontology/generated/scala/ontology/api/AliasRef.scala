import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class AliasRef(
    alias: String,
    ref: Ref
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = AliasRef.baboonDomainVersion
    override def baboonDomainIdentifier: String = AliasRef.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = AliasRef.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = AliasRef.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = AliasRef.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = AliasRef.baboonMinReaderVersions
  }
  
  object AliasRef {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#AliasRef"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[AliasRef] = AliasRef_JsonCodec.instance
  }
  
  object AliasRef_JsonCodec extends BaboonJsonCodec.BaseGenerated[AliasRef, BaboonJsonCodec[AliasRef]] {
    def encode(ctx: BaboonCodecContext, value: AliasRef): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "alias" -> Json.fromString(value.alias),
        "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, AliasRef] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            alias <- getField(jsonObject, "alias").flatMap(v => decodeString(v.hcursor))
            ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
          } yield AliasRef(alias,ref)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to AliasRef: object expected"))
      }
    }
  
    def baboonDomainVersion: String = AliasRef.baboonDomainVersion
    
    def baboonDomainIdentifier: String = AliasRef.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = AliasRef.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[AliasRef]] = Lazy(AliasRef_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[AliasRef]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[AliasRef] = LazyInstance.value
  }
}