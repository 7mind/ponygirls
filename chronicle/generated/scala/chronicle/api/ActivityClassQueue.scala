import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ActivityClassQueue(
    queued: Long,
    claimable: Long,
    held: Long,
    awaitingReclaim: Long,
    oldestWaitingSince: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ActivityClassQueue.baboonDomainVersion
    override def baboonDomainIdentifier: String = ActivityClassQueue.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ActivityClassQueue.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ActivityClassQueue.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ActivityClassQueue.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ActivityClassQueue.baboonMinReaderVersions
  }
  
  object ActivityClassQueue {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityClassQueue"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ActivityClassQueue] = ActivityClassQueue_JsonCodec.instance
  }
  
  object ActivityClassQueue_JsonCodec extends BaboonJsonCodec.BaseGenerated[ActivityClassQueue, BaboonJsonCodec[ActivityClassQueue]] {
    def encode(ctx: BaboonCodecContext, value: ActivityClassQueue): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "queued" -> Json.fromString(value.queued.toString),
        "claimable" -> Json.fromString(value.claimable.toString),
        "held" -> Json.fromString(value.held.toString),
        "awaitingReclaim" -> Json.fromString(value.awaitingReclaim.toString),
        "oldestWaitingSince" -> value.oldestWaitingSince.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityClassQueue] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            queued <- getField(jsonObject, "queued").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            claimable <- getField(jsonObject, "claimable").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            held <- getField(jsonObject, "held").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            awaitingReclaim <- getField(jsonObject, "awaitingReclaim").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            oldestWaitingSince <- getField(jsonObject, "oldestWaitingSince").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield ActivityClassQueue(queued,claimable,held,awaitingReclaim,oldestWaitingSince)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityClassQueue: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ActivityClassQueue.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ActivityClassQueue.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ActivityClassQueue.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityClassQueue]] = Lazy(ActivityClassQueue_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityClassQueue]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityClassQueue] = LazyInstance.value
  }
}