import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CurationProposal(
    expectedGeneration: Long,
    frontier: Long,
    operations: List[Operation]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CurationProposal.baboonDomainVersion
    override def baboonDomainIdentifier: String = CurationProposal.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CurationProposal.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CurationProposal.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CurationProposal.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CurationProposal.baboonMinReaderVersions
  }
  
  object CurationProposal {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CurationProposal"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CurationProposal] = CurationProposal_JsonCodec.instance
  }
  
  object CurationProposal_JsonCodec extends BaboonJsonCodec.BaseGenerated[CurationProposal, BaboonJsonCodec[CurationProposal]] {
    def encode(ctx: BaboonCodecContext, value: CurationProposal): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "expectedGeneration" -> Json.fromString(value.expectedGeneration.toString),
        "frontier" -> Json.fromString(value.frontier.toString),
        "operations" -> Json.fromValues(value.operations.map(e => Operation_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationProposal] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            expectedGeneration <- getField(jsonObject, "expectedGeneration").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            operations <- getField(jsonObject, "operations").flatMap(v => decodeList(Operation_JsonCodec.circeDecoder)(v.hcursor))
          } yield CurationProposal(expectedGeneration,frontier,operations)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CurationProposal: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CurationProposal.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CurationProposal.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CurationProposal.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationProposal]] = Lazy(CurationProposal_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationProposal]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationProposal] = LazyInstance.value
  }
}