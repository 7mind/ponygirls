import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CurationPublicationInput(
    claim: CurationClaim,
    manifest: CurationInputManifest,
    responseOrdinal: Int,
    responseDigest: String,
    proposal: CurationProposal,
    proposalDigest: String,
    publishedAt: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CurationPublicationInput.baboonDomainVersion
    override def baboonDomainIdentifier: String = CurationPublicationInput.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CurationPublicationInput.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CurationPublicationInput.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CurationPublicationInput.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CurationPublicationInput.baboonMinReaderVersions
  }
  
  object CurationPublicationInput {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CurationPublicationInput"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CurationPublicationInput] = CurationPublicationInput_JsonCodec.instance
  }
  
  object CurationPublicationInput_JsonCodec extends BaboonJsonCodec.BaseGenerated[CurationPublicationInput, BaboonJsonCodec[CurationPublicationInput]] {
    def encode(ctx: BaboonCodecContext, value: CurationPublicationInput): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "claim" -> CurationClaim_JsonCodec.instance.encode(ctx, value.claim),
        "manifest" -> CurationInputManifest_JsonCodec.instance.encode(ctx, value.manifest),
        "responseOrdinal" -> Json.fromInt(value.responseOrdinal),
        "responseDigest" -> Json.fromString(value.responseDigest),
        "proposal" -> CurationProposal_JsonCodec.instance.encode(ctx, value.proposal),
        "proposalDigest" -> Json.fromString(value.proposalDigest),
        "publishedAt" -> Json.fromString(value.publishedAt)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationPublicationInput] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            claim <- getField(jsonObject, "claim").flatMap(v => CurationClaim_JsonCodec.circeDecoder(v.hcursor))
            manifest <- getField(jsonObject, "manifest").flatMap(v => CurationInputManifest_JsonCodec.circeDecoder(v.hcursor))
            responseOrdinal <- getField(jsonObject, "responseOrdinal").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            responseDigest <- getField(jsonObject, "responseDigest").flatMap(v => decodeString(v.hcursor))
            proposal <- getField(jsonObject, "proposal").flatMap(v => CurationProposal_JsonCodec.circeDecoder(v.hcursor))
            proposalDigest <- getField(jsonObject, "proposalDigest").flatMap(v => decodeString(v.hcursor))
            publishedAt <- getField(jsonObject, "publishedAt").flatMap(v => decodeString(v.hcursor))
          } yield CurationPublicationInput(claim,manifest,responseOrdinal,responseDigest,proposal,proposalDigest,publishedAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CurationPublicationInput: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CurationPublicationInput.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CurationPublicationInput.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CurationPublicationInput.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationPublicationInput]] = Lazy(CurationPublicationInput_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationPublicationInput]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationPublicationInput] = LazyInstance.value
  }
}