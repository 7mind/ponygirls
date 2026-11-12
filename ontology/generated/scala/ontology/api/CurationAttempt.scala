import io.circe.Decoder.{decodeBoolean, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CurationAttempt(
    claim: CurationClaim,
    state: CurationAttemptState,
    inputManifest: Option[CurationInputManifest],
    candidate: Option[CurationCandidate],
    publication: Option[CurationPublicationReceipt],
    terminalCode: Option[String],
    auditUncertain: Boolean,
    finishedAt: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CurationAttempt.baboonDomainVersion
    override def baboonDomainIdentifier: String = CurationAttempt.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CurationAttempt.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CurationAttempt.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CurationAttempt.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CurationAttempt.baboonMinReaderVersions
  }
  
  object CurationAttempt {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CurationAttempt"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CurationAttempt] = CurationAttempt_JsonCodec.instance
  }
  
  object CurationAttempt_JsonCodec extends BaboonJsonCodec.BaseGenerated[CurationAttempt, BaboonJsonCodec[CurationAttempt]] {
    def encode(ctx: BaboonCodecContext, value: CurationAttempt): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "claim" -> CurationClaim_JsonCodec.instance.encode(ctx, value.claim),
        "state" -> CurationAttemptState_JsonCodec.instance.encode(ctx, value.state),
        "inputManifest" -> value.inputManifest.map(v => CurationInputManifest_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "candidate" -> value.candidate.map(v => CurationCandidate_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "publication" -> value.publication.map(v => CurationPublicationReceipt_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "terminalCode" -> value.terminalCode.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "auditUncertain" -> Json.fromBoolean(value.auditUncertain),
        "finishedAt" -> value.finishedAt.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationAttempt] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            claim <- getField(jsonObject, "claim").flatMap(v => CurationClaim_JsonCodec.circeDecoder(v.hcursor))
            state <- getField(jsonObject, "state").flatMap(v => CurationAttemptState_JsonCodec.circeDecoder(v.hcursor))
            inputManifest <- getField(jsonObject, "inputManifest").flatMap(v => decodeOption(CurationInputManifest_JsonCodec.circeDecoder)(v.hcursor))
            candidate <- getField(jsonObject, "candidate").flatMap(v => decodeOption(CurationCandidate_JsonCodec.circeDecoder)(v.hcursor))
            publication <- getField(jsonObject, "publication").flatMap(v => decodeOption(CurationPublicationReceipt_JsonCodec.circeDecoder)(v.hcursor))
            terminalCode <- getField(jsonObject, "terminalCode").flatMap(v => decodeOption(decodeString)(v.hcursor))
            auditUncertain <- getField(jsonObject, "auditUncertain").flatMap(v => decodeBoolean(v.hcursor))
            finishedAt <- getField(jsonObject, "finishedAt").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield CurationAttempt(claim,state,inputManifest,candidate,publication,terminalCode,auditUncertain,finishedAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CurationAttempt: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CurationAttempt.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CurationAttempt.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CurationAttempt.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationAttempt]] = Lazy(CurationAttempt_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationAttempt]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationAttempt] = LazyInstance.value
  }
}