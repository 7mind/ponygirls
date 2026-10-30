import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package chronicle.api {
  final case class CollectorProgressUpdate(
    collectorId: String,
    sequence: Long,
    runId: UUID,
    phase: CollectorPhase,
    startedAt: String,
    counters: CollectorCounters,
    totalUploadBytes: Long,
    uploadedBytes: Long,
    currentUploadTotalBytes: Option[Long],
    error: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CollectorProgressUpdate.baboonDomainVersion
    override def baboonDomainIdentifier: String = CollectorProgressUpdate.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CollectorProgressUpdate.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CollectorProgressUpdate.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CollectorProgressUpdate.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CollectorProgressUpdate.baboonMinReaderVersions
  }
  
  object CollectorProgressUpdate {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#CollectorProgressUpdate"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CollectorProgressUpdate] = CollectorProgressUpdate_JsonCodec.instance
  }
  
  object CollectorProgressUpdate_JsonCodec extends BaboonJsonCodec.BaseGenerated[CollectorProgressUpdate, BaboonJsonCodec[CollectorProgressUpdate]] {
    def encode(ctx: BaboonCodecContext, value: CollectorProgressUpdate): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "collectorId" -> Json.fromString(value.collectorId),
        "sequence" -> Json.fromString(value.sequence.toString),
        "runId" -> Json.fromString(value.runId.toString()),
        "phase" -> CollectorPhase_JsonCodec.instance.encode(ctx, value.phase),
        "startedAt" -> Json.fromString(value.startedAt),
        "counters" -> CollectorCounters_JsonCodec.instance.encode(ctx, value.counters),
        "totalUploadBytes" -> Json.fromString(value.totalUploadBytes.toString),
        "uploadedBytes" -> Json.fromString(value.uploadedBytes.toString),
        "currentUploadTotalBytes" -> value.currentUploadTotalBytes.map(v => Json.fromString(v.toString)).getOrElse(Json.Null),
        "error" -> value.error.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CollectorProgressUpdate] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            collectorId <- getField(jsonObject, "collectorId").flatMap(v => decodeString(v.hcursor))
            sequence <- getField(jsonObject, "sequence").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            runId <- getField(jsonObject, "runId").flatMap(v => decodeUUID(v.hcursor))
            phase <- getField(jsonObject, "phase").flatMap(v => CollectorPhase_JsonCodec.circeDecoder(v.hcursor))
            startedAt <- getField(jsonObject, "startedAt").flatMap(v => decodeString(v.hcursor))
            counters <- getField(jsonObject, "counters").flatMap(v => CollectorCounters_JsonCodec.circeDecoder(v.hcursor))
            totalUploadBytes <- getField(jsonObject, "totalUploadBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            uploadedBytes <- getField(jsonObject, "uploadedBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            currentUploadTotalBytes <- getField(jsonObject, "currentUploadTotalBytes").flatMap(v => decodeOption(BaboonJsonCodec.decodeLong)(v.hcursor))
            error <- getField(jsonObject, "error").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield CollectorProgressUpdate(collectorId,sequence,runId,phase,startedAt,counters,totalUploadBytes,uploadedBytes,currentUploadTotalBytes,error)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CollectorProgressUpdate: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CollectorProgressUpdate.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CollectorProgressUpdate.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CollectorProgressUpdate.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CollectorProgressUpdate]] = Lazy(CollectorProgressUpdate_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CollectorProgressUpdate]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CollectorProgressUpdate] = LazyInstance.value
  }
}