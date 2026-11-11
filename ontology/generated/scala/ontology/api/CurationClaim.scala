import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class CurationClaim(
    attemptId: UUID,
    scope: String,
    fence: CoordinatorFence,
    baseGeneration: Long,
    frontier: Long,
    previousCoveredFrontier: Long,
    admissionLimits: CurationAdmissionLimits,
    profileId: String,
    profileDigest: String,
    schemaDigest: String,
    graphDigest: String,
    sourceCutDigest: String,
    claimedAt: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CurationClaim.baboonDomainVersion
    override def baboonDomainIdentifier: String = CurationClaim.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CurationClaim.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CurationClaim.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CurationClaim.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CurationClaim.baboonMinReaderVersions
  }
  
  object CurationClaim {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CurationClaim"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CurationClaim] = CurationClaim_JsonCodec.instance
  }
  
  object CurationClaim_JsonCodec extends BaboonJsonCodec.BaseGenerated[CurationClaim, BaboonJsonCodec[CurationClaim]] {
    def encode(ctx: BaboonCodecContext, value: CurationClaim): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "attemptId" -> Json.fromString(value.attemptId.toString()),
        "scope" -> Json.fromString(value.scope),
        "fence" -> CoordinatorFence_JsonCodec.instance.encode(ctx, value.fence),
        "baseGeneration" -> Json.fromString(value.baseGeneration.toString),
        "frontier" -> Json.fromString(value.frontier.toString),
        "previousCoveredFrontier" -> Json.fromString(value.previousCoveredFrontier.toString),
        "admissionLimits" -> CurationAdmissionLimits_JsonCodec.instance.encode(ctx, value.admissionLimits),
        "profileId" -> Json.fromString(value.profileId),
        "profileDigest" -> Json.fromString(value.profileDigest),
        "schemaDigest" -> Json.fromString(value.schemaDigest),
        "graphDigest" -> Json.fromString(value.graphDigest),
        "sourceCutDigest" -> Json.fromString(value.sourceCutDigest),
        "claimedAt" -> Json.fromString(value.claimedAt)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationClaim] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            attemptId <- getField(jsonObject, "attemptId").flatMap(v => decodeUUID(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            fence <- getField(jsonObject, "fence").flatMap(v => CoordinatorFence_JsonCodec.circeDecoder(v.hcursor))
            baseGeneration <- getField(jsonObject, "baseGeneration").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            previousCoveredFrontier <- getField(jsonObject, "previousCoveredFrontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            admissionLimits <- getField(jsonObject, "admissionLimits").flatMap(v => CurationAdmissionLimits_JsonCodec.circeDecoder(v.hcursor))
            profileId <- getField(jsonObject, "profileId").flatMap(v => decodeString(v.hcursor))
            profileDigest <- getField(jsonObject, "profileDigest").flatMap(v => decodeString(v.hcursor))
            schemaDigest <- getField(jsonObject, "schemaDigest").flatMap(v => decodeString(v.hcursor))
            graphDigest <- getField(jsonObject, "graphDigest").flatMap(v => decodeString(v.hcursor))
            sourceCutDigest <- getField(jsonObject, "sourceCutDigest").flatMap(v => decodeString(v.hcursor))
            claimedAt <- getField(jsonObject, "claimedAt").flatMap(v => decodeString(v.hcursor))
          } yield CurationClaim(attemptId,scope,fence,baseGeneration,frontier,previousCoveredFrontier,admissionLimits,profileId,profileDigest,schemaDigest,graphDigest,sourceCutDigest,claimedAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CurationClaim: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CurationClaim.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CurationClaim.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CurationClaim.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationClaim]] = Lazy(CurationClaim_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationClaim]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationClaim] = LazyInstance.value
  }
}