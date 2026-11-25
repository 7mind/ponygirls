import io.circe.Decoder.decodeOption
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ActivityClaimOrderJobsQuery(
    jobs: ActivityJobsQuery,
    order: Option[ActivityClaimOrderSort]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ActivityClaimOrderJobsQuery.baboonDomainVersion
    override def baboonDomainIdentifier: String = ActivityClaimOrderJobsQuery.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ActivityClaimOrderJobsQuery.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ActivityClaimOrderJobsQuery.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ActivityClaimOrderJobsQuery.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ActivityClaimOrderJobsQuery.baboonMinReaderVersions
  }
  
  object ActivityClaimOrderJobsQuery {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityClaimOrderJobsQuery"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ActivityClaimOrderJobsQuery] = ActivityClaimOrderJobsQuery_JsonCodec.instance
  }
  
  object ActivityClaimOrderJobsQuery_JsonCodec extends BaboonJsonCodec.BaseGenerated[ActivityClaimOrderJobsQuery, BaboonJsonCodec[ActivityClaimOrderJobsQuery]] {
    def encode(ctx: BaboonCodecContext, value: ActivityClaimOrderJobsQuery): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "jobs" -> ActivityJobsQuery_JsonCodec.instance.encode(ctx, value.jobs),
        "order" -> value.order.map(v => ActivityClaimOrderSort_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityClaimOrderJobsQuery] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            jobs <- getField(jsonObject, "jobs").flatMap(v => ActivityJobsQuery_JsonCodec.circeDecoder(v.hcursor))
            order <- getField(jsonObject, "order").flatMap(v => decodeOption(ActivityClaimOrderSort_JsonCodec.circeDecoder)(v.hcursor))
          } yield ActivityClaimOrderJobsQuery(jobs,order)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityClaimOrderJobsQuery: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ActivityClaimOrderJobsQuery.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ActivityClaimOrderJobsQuery.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ActivityClaimOrderJobsQuery.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityClaimOrderJobsQuery]] = Lazy(ActivityClaimOrderJobsQuery_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityClaimOrderJobsQuery]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityClaimOrderJobsQuery] = LazyInstance.value
  }
}