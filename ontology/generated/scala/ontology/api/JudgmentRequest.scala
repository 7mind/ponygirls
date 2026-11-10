import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class JudgmentRequest(
    scope: String,
    requestId: UUID,
    presentationId: UUID,
    kind: JudgmentKind,
    rationale: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = JudgmentRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = JudgmentRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = JudgmentRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = JudgmentRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = JudgmentRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = JudgmentRequest.baboonMinReaderVersions
  }
  
  object JudgmentRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#JudgmentRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[JudgmentRequest] = JudgmentRequest_JsonCodec.instance
  }
  
  object JudgmentRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[JudgmentRequest, BaboonJsonCodec[JudgmentRequest]] {
    def encode(ctx: BaboonCodecContext, value: JudgmentRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "requestId" -> Json.fromString(value.requestId.toString()),
        "presentationId" -> Json.fromString(value.presentationId.toString()),
        "kind" -> JudgmentKind_JsonCodec.instance.encode(ctx, value.kind),
        "rationale" -> Json.fromString(value.rationale)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, JudgmentRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            presentationId <- getField(jsonObject, "presentationId").flatMap(v => decodeUUID(v.hcursor))
            kind <- getField(jsonObject, "kind").flatMap(v => JudgmentKind_JsonCodec.circeDecoder(v.hcursor))
            rationale <- getField(jsonObject, "rationale").flatMap(v => decodeString(v.hcursor))
          } yield JudgmentRequest(scope,requestId,presentationId,kind,rationale)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to JudgmentRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = JudgmentRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = JudgmentRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = JudgmentRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[JudgmentRequest]] = Lazy(JudgmentRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[JudgmentRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[JudgmentRequest] = LazyInstance.value
  }
}