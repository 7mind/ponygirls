import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class GateBasis(
    references: List[Ref],
    selectionWitnesses: List[Ref]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = GateBasis.baboonDomainVersion
    override def baboonDomainIdentifier: String = GateBasis.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = GateBasis.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = GateBasis.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = GateBasis.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = GateBasis.baboonMinReaderVersions
  }
  
  object GateBasis {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#GateBasis"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[GateBasis] = GateBasis_JsonCodec.instance
  }
  
  object GateBasis_JsonCodec extends BaboonJsonCodec.BaseGenerated[GateBasis, BaboonJsonCodec[GateBasis]] {
    def encode(ctx: BaboonCodecContext, value: GateBasis): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "references" -> Json.fromValues(value.references.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "selectionWitnesses" -> Json.fromValues(value.selectionWitnesses.map(e => Ref_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GateBasis] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            references <- getField(jsonObject, "references").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            selectionWitnesses <- getField(jsonObject, "selectionWitnesses").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
          } yield GateBasis(references,selectionWitnesses)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to GateBasis: object expected"))
      }
    }
  
    def baboonDomainVersion: String = GateBasis.baboonDomainVersion
    
    def baboonDomainIdentifier: String = GateBasis.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = GateBasis.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GateBasis]] = Lazy(GateBasis_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[GateBasis]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[GateBasis] = LazyInstance.value
  }
}