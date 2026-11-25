import io.circe.Decoder.{decodeBoolean, decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package chronicle.api {
  final case class ActivityJobClaimOrder(
    jobId: UUID,
    waitingSince: Option[String],
    bulk: Option[Boolean],
    waiting: Option[ActivityJobWaiting],
    ahead: Option[Long]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ActivityJobClaimOrder.baboonDomainVersion
    override def baboonDomainIdentifier: String = ActivityJobClaimOrder.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ActivityJobClaimOrder.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ActivityJobClaimOrder.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ActivityJobClaimOrder.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ActivityJobClaimOrder.baboonMinReaderVersions
  }
  
  object ActivityJobClaimOrder {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityJobClaimOrder"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ActivityJobClaimOrder] = ActivityJobClaimOrder_JsonCodec.instance
  }
  
  object ActivityJobClaimOrder_JsonCodec extends BaboonJsonCodec.BaseGenerated[ActivityJobClaimOrder, BaboonJsonCodec[ActivityJobClaimOrder]] {
    def encode(ctx: BaboonCodecContext, value: ActivityJobClaimOrder): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "jobId" -> Json.fromString(value.jobId.toString()),
        "waitingSince" -> value.waitingSince.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "bulk" -> value.bulk.map(v => Json.fromBoolean(v)).getOrElse(Json.Null),
        "waiting" -> value.waiting.map(v => ActivityJobWaiting_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "ahead" -> value.ahead.map(v => Json.fromString(v.toString)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobClaimOrder] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            jobId <- getField(jsonObject, "jobId").flatMap(v => decodeUUID(v.hcursor))
            waitingSince <- getField(jsonObject, "waitingSince").flatMap(v => decodeOption(decodeString)(v.hcursor))
            bulk <- getField(jsonObject, "bulk").flatMap(v => decodeOption(decodeBoolean)(v.hcursor))
            waiting <- getField(jsonObject, "waiting").flatMap(v => decodeOption(ActivityJobWaiting_JsonCodec.circeDecoder)(v.hcursor))
            ahead <- getField(jsonObject, "ahead").flatMap(v => decodeOption(BaboonJsonCodec.decodeLong)(v.hcursor))
          } yield ActivityJobClaimOrder(jobId,waitingSince,bulk,waiting,ahead)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityJobClaimOrder: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ActivityJobClaimOrder.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ActivityJobClaimOrder.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ActivityJobClaimOrder.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobClaimOrder]] = Lazy(ActivityJobClaimOrder_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobClaimOrder]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityJobClaimOrder] = LazyInstance.value
  }
}