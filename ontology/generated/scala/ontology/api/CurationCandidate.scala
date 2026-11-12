import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class CurationCandidate(
    attemptId: UUID,
    inputDigest: String,
    responseOrdinal: Int,
    responseDigest: String,
    proposal: CurationProposal,
    proposalDigest: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CurationCandidate.baboonDomainVersion
    override def baboonDomainIdentifier: String = CurationCandidate.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CurationCandidate.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CurationCandidate.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CurationCandidate.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CurationCandidate.baboonMinReaderVersions
  }
  
  object CurationCandidate {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CurationCandidate"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CurationCandidate] = CurationCandidate_JsonCodec.instance
  }
  
  object CurationCandidate_JsonCodec extends BaboonJsonCodec.BaseGenerated[CurationCandidate, BaboonJsonCodec[CurationCandidate]] {
    def encode(ctx: BaboonCodecContext, value: CurationCandidate): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "attemptId" -> Json.fromString(value.attemptId.toString()),
        "inputDigest" -> Json.fromString(value.inputDigest),
        "responseOrdinal" -> Json.fromInt(value.responseOrdinal),
        "responseDigest" -> Json.fromString(value.responseDigest),
        "proposal" -> CurationProposal_JsonCodec.instance.encode(ctx, value.proposal),
        "proposalDigest" -> Json.fromString(value.proposalDigest)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationCandidate] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            attemptId <- getField(jsonObject, "attemptId").flatMap(v => decodeUUID(v.hcursor))
            inputDigest <- getField(jsonObject, "inputDigest").flatMap(v => decodeString(v.hcursor))
            responseOrdinal <- getField(jsonObject, "responseOrdinal").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            responseDigest <- getField(jsonObject, "responseDigest").flatMap(v => decodeString(v.hcursor))
            proposal <- getField(jsonObject, "proposal").flatMap(v => CurationProposal_JsonCodec.circeDecoder(v.hcursor))
            proposalDigest <- getField(jsonObject, "proposalDigest").flatMap(v => decodeString(v.hcursor))
          } yield CurationCandidate(attemptId,inputDigest,responseOrdinal,responseDigest,proposal,proposalDigest)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CurationCandidate: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CurationCandidate.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CurationCandidate.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CurationCandidate.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationCandidate]] = Lazy(CurationCandidate_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationCandidate]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationCandidate] = LazyInstance.value
  }
}