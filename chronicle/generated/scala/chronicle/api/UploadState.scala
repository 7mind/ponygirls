import io.circe.Decoder.{decodeBoolean, decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package chronicle.api {
  final case class UploadState(
    uploadId: UUID,
    requestId: UUID,
    phase: UploadPhase,
    append: Boolean,
    receivedParts: Int,
    receivedRawBytes: Long,
    receivedMessages: Int,
    lastPartSha256: Option[String],
    expiresInSeconds: Int,
    limits: UploadLimits,
    receipt: Option[IngestReceipt],
    failure: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = UploadState.baboonDomainVersion
    override def baboonDomainIdentifier: String = UploadState.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = UploadState.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = UploadState.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = UploadState.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = UploadState.baboonMinReaderVersions
  }
  
  object UploadState {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#UploadState"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[UploadState] = UploadState_JsonCodec.instance
  }
  
  object UploadState_JsonCodec extends BaboonJsonCodec.BaseGenerated[UploadState, BaboonJsonCodec[UploadState]] {
    def encode(ctx: BaboonCodecContext, value: UploadState): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "uploadId" -> Json.fromString(value.uploadId.toString()),
        "requestId" -> Json.fromString(value.requestId.toString()),
        "phase" -> UploadPhase_JsonCodec.instance.encode(ctx, value.phase),
        "append" -> Json.fromBoolean(value.append),
        "receivedParts" -> Json.fromInt(value.receivedParts),
        "receivedRawBytes" -> Json.fromString(value.receivedRawBytes.toString),
        "receivedMessages" -> Json.fromInt(value.receivedMessages),
        "lastPartSha256" -> value.lastPartSha256.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "expiresInSeconds" -> Json.fromInt(value.expiresInSeconds),
        "limits" -> UploadLimits_JsonCodec.instance.encode(ctx, value.limits),
        "receipt" -> value.receipt.map(v => IngestReceipt_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "failure" -> value.failure.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, UploadState] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            uploadId <- getField(jsonObject, "uploadId").flatMap(v => decodeUUID(v.hcursor))
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            phase <- getField(jsonObject, "phase").flatMap(v => UploadPhase_JsonCodec.circeDecoder(v.hcursor))
            append <- getField(jsonObject, "append").flatMap(v => decodeBoolean(v.hcursor))
            receivedParts <- getField(jsonObject, "receivedParts").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            receivedRawBytes <- getField(jsonObject, "receivedRawBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            receivedMessages <- getField(jsonObject, "receivedMessages").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            lastPartSha256 <- getField(jsonObject, "lastPartSha256").flatMap(v => decodeOption(decodeString)(v.hcursor))
            expiresInSeconds <- getField(jsonObject, "expiresInSeconds").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            limits <- getField(jsonObject, "limits").flatMap(v => UploadLimits_JsonCodec.circeDecoder(v.hcursor))
            receipt <- getField(jsonObject, "receipt").flatMap(v => decodeOption(IngestReceipt_JsonCodec.circeDecoder)(v.hcursor))
            failure <- getField(jsonObject, "failure").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield UploadState(uploadId,requestId,phase,append,receivedParts,receivedRawBytes,receivedMessages,lastPartSha256,expiresInSeconds,limits,receipt,failure)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to UploadState: object expected"))
      }
    }
  
    def baboonDomainVersion: String = UploadState.baboonDomainVersion
    
    def baboonDomainIdentifier: String = UploadState.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = UploadState.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[UploadState]] = Lazy(UploadState_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[UploadState]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[UploadState] = LazyInstance.value
  }
}