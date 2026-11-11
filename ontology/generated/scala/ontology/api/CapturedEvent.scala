import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class CapturedEvent(
    id: UUID,
    scope: String,
    sourceNamespace: String,
    frontier: Long,
    context: ContextRecord,
    origin: EventOrigin,
    metadata: CaptureMetadata,
    text: String,
    observation: Observation,
    reviewResponse: Option[ReviewResponseLink],
    provenance: Provenance
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CapturedEvent.baboonDomainVersion
    override def baboonDomainIdentifier: String = CapturedEvent.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CapturedEvent.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CapturedEvent.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CapturedEvent.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CapturedEvent.baboonMinReaderVersions
  }
  
  object CapturedEvent {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CapturedEvent"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CapturedEvent] = CapturedEvent_JsonCodec.instance
  }
  
  object CapturedEvent_JsonCodec extends BaboonJsonCodec.BaseGenerated[CapturedEvent, BaboonJsonCodec[CapturedEvent]] {
    def encode(ctx: BaboonCodecContext, value: CapturedEvent): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "scope" -> Json.fromString(value.scope),
        "sourceNamespace" -> Json.fromString(value.sourceNamespace),
        "frontier" -> Json.fromString(value.frontier.toString),
        "context" -> ContextRecord_JsonCodec.instance.encode(ctx, value.context),
        "origin" -> EventOrigin_JsonCodec.instance.encode(ctx, value.origin),
        "metadata" -> CaptureMetadata_JsonCodec.instance.encode(ctx, value.metadata),
        "text" -> Json.fromString(value.text),
        "observation" -> Observation_JsonCodec.instance.encode(ctx, value.observation),
        "reviewResponse" -> value.reviewResponse.map(v => ReviewResponseLink_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "provenance" -> Provenance_JsonCodec.instance.encode(ctx, value.provenance)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CapturedEvent] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            sourceNamespace <- getField(jsonObject, "sourceNamespace").flatMap(v => decodeString(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            context <- getField(jsonObject, "context").flatMap(v => ContextRecord_JsonCodec.circeDecoder(v.hcursor))
            origin <- getField(jsonObject, "origin").flatMap(v => EventOrigin_JsonCodec.circeDecoder(v.hcursor))
            metadata <- getField(jsonObject, "metadata").flatMap(v => CaptureMetadata_JsonCodec.circeDecoder(v.hcursor))
            text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
            observation <- getField(jsonObject, "observation").flatMap(v => Observation_JsonCodec.circeDecoder(v.hcursor))
            reviewResponse <- getField(jsonObject, "reviewResponse").flatMap(v => decodeOption(ReviewResponseLink_JsonCodec.circeDecoder)(v.hcursor))
            provenance <- getField(jsonObject, "provenance").flatMap(v => Provenance_JsonCodec.circeDecoder(v.hcursor))
          } yield CapturedEvent(id,scope,sourceNamespace,frontier,context,origin,metadata,text,observation,reviewResponse,provenance)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CapturedEvent: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CapturedEvent.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CapturedEvent.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CapturedEvent.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CapturedEvent]] = Lazy(CapturedEvent_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CapturedEvent]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CapturedEvent] = LazyInstance.value
  }
}