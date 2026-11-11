import io.circe.Decoder.{decodeBoolean, decodeList, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class IngestResult(
    scope: String,
    requestId: UUID,
    eventId: UUID,
    sourceNamespace: String,
    source: Ref,
    artifacts: List[Ref],
    frontier: Long,
    replayed: Boolean
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = IngestResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = IngestResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = IngestResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = IngestResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = IngestResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = IngestResult.baboonMinReaderVersions
  }
  
  object IngestResult {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#IngestResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[IngestResult] = IngestResult_JsonCodec.instance
  }
  
  object IngestResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[IngestResult, BaboonJsonCodec[IngestResult]] {
    def encode(ctx: BaboonCodecContext, value: IngestResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "requestId" -> Json.fromString(value.requestId.toString()),
        "eventId" -> Json.fromString(value.eventId.toString()),
        "sourceNamespace" -> Json.fromString(value.sourceNamespace),
        "source" -> Ref_JsonCodec.instance.encode(ctx, value.source),
        "artifacts" -> Json.fromValues(value.artifacts.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "frontier" -> Json.fromString(value.frontier.toString),
        "replayed" -> Json.fromBoolean(value.replayed)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, IngestResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            eventId <- getField(jsonObject, "eventId").flatMap(v => decodeUUID(v.hcursor))
            sourceNamespace <- getField(jsonObject, "sourceNamespace").flatMap(v => decodeString(v.hcursor))
            source <- getField(jsonObject, "source").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            artifacts <- getField(jsonObject, "artifacts").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            replayed <- getField(jsonObject, "replayed").flatMap(v => decodeBoolean(v.hcursor))
          } yield IngestResult(scope,requestId,eventId,sourceNamespace,source,artifacts,frontier,replayed)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to IngestResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = IngestResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = IngestResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = IngestResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[IngestResult]] = Lazy(IngestResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[IngestResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[IngestResult] = LazyInstance.value
  }
}