import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class CurationPublicationReceipt(
    attemptId: UUID,
    scope: String,
    input: Ref,
    generation: Long,
    frontier: Long,
    coveredFrontier: Long,
    recordedAt: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CurationPublicationReceipt.baboonDomainVersion
    override def baboonDomainIdentifier: String = CurationPublicationReceipt.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CurationPublicationReceipt.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CurationPublicationReceipt.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CurationPublicationReceipt.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CurationPublicationReceipt.baboonMinReaderVersions
  }
  
  object CurationPublicationReceipt {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CurationPublicationReceipt"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CurationPublicationReceipt] = CurationPublicationReceipt_JsonCodec.instance
  }
  
  object CurationPublicationReceipt_JsonCodec extends BaboonJsonCodec.BaseGenerated[CurationPublicationReceipt, BaboonJsonCodec[CurationPublicationReceipt]] {
    def encode(ctx: BaboonCodecContext, value: CurationPublicationReceipt): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "attemptId" -> Json.fromString(value.attemptId.toString()),
        "scope" -> Json.fromString(value.scope),
        "input" -> Ref_JsonCodec.instance.encode(ctx, value.input),
        "generation" -> Json.fromString(value.generation.toString),
        "frontier" -> Json.fromString(value.frontier.toString),
        "coveredFrontier" -> Json.fromString(value.coveredFrontier.toString),
        "recordedAt" -> Json.fromString(value.recordedAt)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationPublicationReceipt] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            attemptId <- getField(jsonObject, "attemptId").flatMap(v => decodeUUID(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            input <- getField(jsonObject, "input").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            coveredFrontier <- getField(jsonObject, "coveredFrontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            recordedAt <- getField(jsonObject, "recordedAt").flatMap(v => decodeString(v.hcursor))
          } yield CurationPublicationReceipt(attemptId,scope,input,generation,frontier,coveredFrontier,recordedAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CurationPublicationReceipt: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CurationPublicationReceipt.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CurationPublicationReceipt.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CurationPublicationReceipt.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationPublicationReceipt]] = Lazy(CurationPublicationReceipt_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationPublicationReceipt]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationPublicationReceipt] = LazyInstance.value
  }
}