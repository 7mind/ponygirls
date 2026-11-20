import io.circe.Decoder.{decodeBoolean, decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package chronicle.api {
  final case class UploadOpen(
    requestId: UUID,
    source: SourceIdentity,
    expectedRevision: Int,
    rawPath: String,
    base: Option[UploadBase],
    digest: String,
    rawBytes: Long,
    messageCount: Int,
    messageChain: String,
    completion: Completion,
    redacted: Boolean,
    metadata: Metadata
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = UploadOpen.baboonDomainVersion
    override def baboonDomainIdentifier: String = UploadOpen.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = UploadOpen.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = UploadOpen.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = UploadOpen.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = UploadOpen.baboonMinReaderVersions
  }
  
  object UploadOpen {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#UploadOpen"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[UploadOpen] = UploadOpen_JsonCodec.instance
  }
  
  object UploadOpen_JsonCodec extends BaboonJsonCodec.BaseGenerated[UploadOpen, BaboonJsonCodec[UploadOpen]] {
    def encode(ctx: BaboonCodecContext, value: UploadOpen): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "requestId" -> Json.fromString(value.requestId.toString()),
        "source" -> SourceIdentity_JsonCodec.instance.encode(ctx, value.source),
        "expectedRevision" -> Json.fromInt(value.expectedRevision),
        "rawPath" -> Json.fromString(value.rawPath),
        "base" -> value.base.map(v => UploadBase_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "digest" -> Json.fromString(value.digest),
        "rawBytes" -> Json.fromString(value.rawBytes.toString),
        "messageCount" -> Json.fromInt(value.messageCount),
        "messageChain" -> Json.fromString(value.messageChain),
        "completion" -> Completion_JsonCodec.instance.encode(ctx, value.completion),
        "redacted" -> Json.fromBoolean(value.redacted),
        "metadata" -> Metadata_JsonCodec.instance.encode(ctx, value.metadata)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, UploadOpen] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            source <- getField(jsonObject, "source").flatMap(v => SourceIdentity_JsonCodec.circeDecoder(v.hcursor))
            expectedRevision <- getField(jsonObject, "expectedRevision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            rawPath <- getField(jsonObject, "rawPath").flatMap(v => decodeString(v.hcursor))
            base <- getField(jsonObject, "base").flatMap(v => decodeOption(UploadBase_JsonCodec.circeDecoder)(v.hcursor))
            digest <- getField(jsonObject, "digest").flatMap(v => decodeString(v.hcursor))
            rawBytes <- getField(jsonObject, "rawBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            messageCount <- getField(jsonObject, "messageCount").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            messageChain <- getField(jsonObject, "messageChain").flatMap(v => decodeString(v.hcursor))
            completion <- getField(jsonObject, "completion").flatMap(v => Completion_JsonCodec.circeDecoder(v.hcursor))
            redacted <- getField(jsonObject, "redacted").flatMap(v => decodeBoolean(v.hcursor))
            metadata <- getField(jsonObject, "metadata").flatMap(v => Metadata_JsonCodec.circeDecoder(v.hcursor))
          } yield UploadOpen(requestId,source,expectedRevision,rawPath,base,digest,rawBytes,messageCount,messageChain,completion,redacted,metadata)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to UploadOpen: object expected"))
      }
    }
  
    def baboonDomainVersion: String = UploadOpen.baboonDomainVersion
    
    def baboonDomainIdentifier: String = UploadOpen.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = UploadOpen.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[UploadOpen]] = Lazy(UploadOpen_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[UploadOpen]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[UploadOpen] = LazyInstance.value
  }
}