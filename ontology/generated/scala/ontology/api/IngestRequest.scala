import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class IngestRequest(
    scope: String,
    requestId: UUID,
    eventId: UUID,
    occurrenceContext: Option[ContextRecordInput],
    contributionContext: Option[ContextRecordInput],
    origin: EventOrigin,
    metadata: CaptureMetadata,
    text: String,
    observation: Observation
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = IngestRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = IngestRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = IngestRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = IngestRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = IngestRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = IngestRequest.baboonMinReaderVersions
  }
  
  object IngestRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#IngestRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[IngestRequest] = IngestRequest_JsonCodec.instance
  }
  
  object IngestRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[IngestRequest, BaboonJsonCodec[IngestRequest]] {
    def encode(ctx: BaboonCodecContext, value: IngestRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "requestId" -> Json.fromString(value.requestId.toString()),
        "eventId" -> Json.fromString(value.eventId.toString()),
        "occurrenceContext" -> value.occurrenceContext.map(v => ContextRecordInput_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "contributionContext" -> value.contributionContext.map(v => ContextRecordInput_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "origin" -> EventOrigin_JsonCodec.instance.encode(ctx, value.origin),
        "metadata" -> CaptureMetadata_JsonCodec.instance.encode(ctx, value.metadata),
        "text" -> Json.fromString(value.text),
        "observation" -> Observation_JsonCodec.instance.encode(ctx, value.observation)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, IngestRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            eventId <- getField(jsonObject, "eventId").flatMap(v => decodeUUID(v.hcursor))
            occurrenceContext <- getField(jsonObject, "occurrenceContext").flatMap(v => decodeOption(ContextRecordInput_JsonCodec.circeDecoder)(v.hcursor))
            contributionContext <- getField(jsonObject, "contributionContext").flatMap(v => decodeOption(ContextRecordInput_JsonCodec.circeDecoder)(v.hcursor))
            origin <- getField(jsonObject, "origin").flatMap(v => EventOrigin_JsonCodec.circeDecoder(v.hcursor))
            metadata <- getField(jsonObject, "metadata").flatMap(v => CaptureMetadata_JsonCodec.circeDecoder(v.hcursor))
            text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
            observation <- getField(jsonObject, "observation").flatMap(v => Observation_JsonCodec.circeDecoder(v.hcursor))
          } yield IngestRequest(scope,requestId,eventId,occurrenceContext,contributionContext,origin,metadata,text,observation)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to IngestRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = IngestRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = IngestRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = IngestRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[IngestRequest]] = Lazy(IngestRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[IngestRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[IngestRequest] = LazyInstance.value
  }
}