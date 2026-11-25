import io.circe.Decoder.decodeOption
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ActivityQueue(
    claimOrder: ActivityClaimOrder,
    fresh: ActivityClassQueue,
    bulk: ActivityClassQueue,
    unclassified: ActivityClassQueue,
    awaitingLarge: Long,
    largeAhead: Option[Long]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ActivityQueue.baboonDomainVersion
    override def baboonDomainIdentifier: String = ActivityQueue.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ActivityQueue.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ActivityQueue.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ActivityQueue.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ActivityQueue.baboonMinReaderVersions
  }
  
  object ActivityQueue {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityQueue"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ActivityQueue] = ActivityQueue_JsonCodec.instance
  }
  
  object ActivityQueue_JsonCodec extends BaboonJsonCodec.BaseGenerated[ActivityQueue, BaboonJsonCodec[ActivityQueue]] {
    def encode(ctx: BaboonCodecContext, value: ActivityQueue): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "claimOrder" -> ActivityClaimOrder_JsonCodec.instance.encode(ctx, value.claimOrder),
        "fresh" -> ActivityClassQueue_JsonCodec.instance.encode(ctx, value.fresh),
        "bulk" -> ActivityClassQueue_JsonCodec.instance.encode(ctx, value.bulk),
        "unclassified" -> ActivityClassQueue_JsonCodec.instance.encode(ctx, value.unclassified),
        "awaitingLarge" -> Json.fromString(value.awaitingLarge.toString),
        "largeAhead" -> value.largeAhead.map(v => Json.fromString(v.toString)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityQueue] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            claimOrder <- getField(jsonObject, "claimOrder").flatMap(v => ActivityClaimOrder_JsonCodec.circeDecoder(v.hcursor))
            fresh <- getField(jsonObject, "fresh").flatMap(v => ActivityClassQueue_JsonCodec.circeDecoder(v.hcursor))
            bulk <- getField(jsonObject, "bulk").flatMap(v => ActivityClassQueue_JsonCodec.circeDecoder(v.hcursor))
            unclassified <- getField(jsonObject, "unclassified").flatMap(v => ActivityClassQueue_JsonCodec.circeDecoder(v.hcursor))
            awaitingLarge <- getField(jsonObject, "awaitingLarge").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            largeAhead <- getField(jsonObject, "largeAhead").flatMap(v => decodeOption(BaboonJsonCodec.decodeLong)(v.hcursor))
          } yield ActivityQueue(claimOrder,fresh,bulk,unclassified,awaitingLarge,largeAhead)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityQueue: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ActivityQueue.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ActivityQueue.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ActivityQueue.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityQueue]] = Lazy(ActivityQueue_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityQueue]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityQueue] = LazyInstance.value
  }
}