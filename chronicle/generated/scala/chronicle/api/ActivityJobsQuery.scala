import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ActivityJobsQuery(
    collectorId: Option[String],
    scope: ActivityJobScope,
    expression: String,
    sort: ActivityJobSort,
    direction: SortDirection,
    cursor: Option[String],
    limit: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ActivityJobsQuery.baboonDomainVersion
    override def baboonDomainIdentifier: String = ActivityJobsQuery.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ActivityJobsQuery.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ActivityJobsQuery.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ActivityJobsQuery.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ActivityJobsQuery.baboonMinReaderVersions
  }
  
  object ActivityJobsQuery {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityJobsQuery"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ActivityJobsQuery] = ActivityJobsQuery_JsonCodec.instance
  }
  
  object ActivityJobsQuery_JsonCodec extends BaboonJsonCodec.BaseGenerated[ActivityJobsQuery, BaboonJsonCodec[ActivityJobsQuery]] {
    def encode(ctx: BaboonCodecContext, value: ActivityJobsQuery): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "collectorId" -> value.collectorId.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "scope" -> ActivityJobScope_JsonCodec.instance.encode(ctx, value.scope),
        "expression" -> Json.fromString(value.expression),
        "sort" -> ActivityJobSort_JsonCodec.instance.encode(ctx, value.sort),
        "direction" -> SortDirection_JsonCodec.instance.encode(ctx, value.direction),
        "cursor" -> value.cursor.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "limit" -> Json.fromInt(value.limit)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobsQuery] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            collectorId <- getField(jsonObject, "collectorId").flatMap(v => decodeOption(decodeString)(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => ActivityJobScope_JsonCodec.circeDecoder(v.hcursor))
            expression <- getField(jsonObject, "expression").flatMap(v => decodeString(v.hcursor))
            sort <- getField(jsonObject, "sort").flatMap(v => ActivityJobSort_JsonCodec.circeDecoder(v.hcursor))
            direction <- getField(jsonObject, "direction").flatMap(v => SortDirection_JsonCodec.circeDecoder(v.hcursor))
            cursor <- getField(jsonObject, "cursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
            limit <- getField(jsonObject, "limit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield ActivityJobsQuery(collectorId,scope,expression,sort,direction,cursor,limit)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityJobsQuery: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ActivityJobsQuery.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ActivityJobsQuery.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ActivityJobsQuery.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobsQuery]] = Lazy(ActivityJobsQuery_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobsQuery]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityJobsQuery] = LazyInstance.value
  }
}