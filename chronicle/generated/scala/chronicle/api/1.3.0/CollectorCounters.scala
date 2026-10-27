import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_3_0 {
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.5.0")
  final case class CollectorCounters(
    discovered: Int,
    scanned: Int,
    waiting: Int,
    excluded: Int,
    unchanged: Int,
    enqueued: Int,
    uploaded: Int,
    uploadFailures: Int,
    quarantined: Int,
    pending: Int,
    stopped: Int,
    conflicts: Int,
    scannedBytes: Long
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = CollectorCounters.baboonDomainVersion
    override def baboonDomainIdentifier: String = CollectorCounters.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CollectorCounters.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CollectorCounters.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CollectorCounters.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CollectorCounters.baboonMinReaderVersions
  }
  
  object CollectorCounters {
    def baboonDomainVersion: String = "1.3.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#CollectorCounters"
    private lazy val _baboonSameInVersions: List[String] = List("1.2.0", "1.3.0", "1.4.0", "1.5.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.2.0", "prefix-compact" -> "1.2.0", "prefix-any-mode" -> "1.2.0", "identical" -> "1.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[CollectorCounters] = CollectorCounters_JsonCodec.instance
  }
  
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.5.0")
  object CollectorCounters_JsonCodec extends BaboonJsonCodec.BaseGenerated[CollectorCounters, BaboonJsonCodec[CollectorCounters]] {
    def encode(ctx: BaboonCodecContext, value: CollectorCounters): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "discovered" -> Json.fromInt(value.discovered),
        "scanned" -> Json.fromInt(value.scanned),
        "waiting" -> Json.fromInt(value.waiting),
        "excluded" -> Json.fromInt(value.excluded),
        "unchanged" -> Json.fromInt(value.unchanged),
        "enqueued" -> Json.fromInt(value.enqueued),
        "uploaded" -> Json.fromInt(value.uploaded),
        "uploadFailures" -> Json.fromInt(value.uploadFailures),
        "quarantined" -> Json.fromInt(value.quarantined),
        "pending" -> Json.fromInt(value.pending),
        "stopped" -> Json.fromInt(value.stopped),
        "conflicts" -> Json.fromInt(value.conflicts),
        "scannedBytes" -> Json.fromString(value.scannedBytes.toString)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CollectorCounters] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            discovered <- getField(jsonObject, "discovered").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            scanned <- getField(jsonObject, "scanned").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            waiting <- getField(jsonObject, "waiting").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            excluded <- getField(jsonObject, "excluded").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            unchanged <- getField(jsonObject, "unchanged").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            enqueued <- getField(jsonObject, "enqueued").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            uploaded <- getField(jsonObject, "uploaded").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            uploadFailures <- getField(jsonObject, "uploadFailures").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            quarantined <- getField(jsonObject, "quarantined").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            pending <- getField(jsonObject, "pending").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            stopped <- getField(jsonObject, "stopped").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            conflicts <- getField(jsonObject, "conflicts").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            scannedBytes <- getField(jsonObject, "scannedBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
          } yield CollectorCounters(discovered,scanned,waiting,excluded,unchanged,enqueued,uploaded,uploadFailures,quarantined,pending,stopped,conflicts,scannedBytes)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CollectorCounters: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CollectorCounters.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CollectorCounters.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CollectorCounters.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CollectorCounters]] = Lazy(CollectorCounters_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CollectorCounters]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CollectorCounters] = LazyInstance.value
  }
}