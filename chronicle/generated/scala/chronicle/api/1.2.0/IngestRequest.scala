import io.circe.Decoder.{decodeBoolean, decodeList, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}
import java.util.UUID

package chronicle.api.v1_2_0 {
  @deprecated("Version 1.2.0 is deprecated, you should migrate to 1.8.0")
  final case class IngestRequest(
    requestId: UUID,
    source: SourceIdentity,
    expectedRevision: Int,
    digest: String,
    completion: Completion,
    redacted: Boolean,
    metadata: Metadata,
    messages: List[Message],
    files: List[RawFile]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = IngestRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = IngestRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = IngestRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = IngestRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = IngestRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = IngestRequest.baboonMinReaderVersions
  }
  
  object IngestRequest {
    def baboonDomainVersion: String = "1.2.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#IngestRequest"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.2.0" -> "identical", "1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[IngestRequest] = IngestRequest_JsonCodec.instance
  }
  
  @deprecated("Version 1.2.0 is deprecated, you should migrate to 1.8.0")
  object IngestRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[IngestRequest, BaboonJsonCodec[IngestRequest]] {
    def encode(ctx: BaboonCodecContext, value: IngestRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "requestId" -> Json.fromString(value.requestId.toString()),
        "source" -> SourceIdentity_JsonCodec.instance.encode(ctx, value.source),
        "expectedRevision" -> Json.fromInt(value.expectedRevision),
        "digest" -> Json.fromString(value.digest),
        "completion" -> Completion_JsonCodec.instance.encode(ctx, value.completion),
        "redacted" -> Json.fromBoolean(value.redacted),
        "metadata" -> Metadata_JsonCodec.instance.encode(ctx, value.metadata),
        "messages" -> Json.fromValues(value.messages.map(e => Message_JsonCodec.instance.encode(ctx, e))),
        "files" -> Json.fromValues(value.files.map(e => RawFile_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, IngestRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            source <- getField(jsonObject, "source").flatMap(v => SourceIdentity_JsonCodec.circeDecoder(v.hcursor))
            expectedRevision <- getField(jsonObject, "expectedRevision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            digest <- getField(jsonObject, "digest").flatMap(v => decodeString(v.hcursor))
            completion <- getField(jsonObject, "completion").flatMap(v => Completion_JsonCodec.circeDecoder(v.hcursor))
            redacted <- getField(jsonObject, "redacted").flatMap(v => decodeBoolean(v.hcursor))
            metadata <- getField(jsonObject, "metadata").flatMap(v => Metadata_JsonCodec.circeDecoder(v.hcursor))
            messages <- getField(jsonObject, "messages").flatMap(v => decodeList(Message_JsonCodec.circeDecoder)(v.hcursor))
            files <- getField(jsonObject, "files").flatMap(v => decodeList(RawFile_JsonCodec.circeDecoder)(v.hcursor))
          } yield IngestRequest(requestId,source,expectedRevision,digest,completion,redacted,metadata,messages,files)
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