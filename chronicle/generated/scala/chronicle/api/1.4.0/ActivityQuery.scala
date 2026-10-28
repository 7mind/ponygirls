import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_4_0 {
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.7.0")
  final case class ActivityQuery(
    expression: String,
    sort: ActivityCollectorSort,
    direction: SortDirection,
    cursor: Option[String],
    limit: Int
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = ActivityQuery.baboonDomainVersion
    override def baboonDomainIdentifier: String = ActivityQuery.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ActivityQuery.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ActivityQuery.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ActivityQuery.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ActivityQuery.baboonMinReaderVersions
  }
  
  object ActivityQuery {
    def baboonDomainVersion: String = "1.4.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityQuery"
    private lazy val _baboonSameInVersions: List[String] = List("1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.3.0", "identical" -> "1.3.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[ActivityQuery] = ActivityQuery_JsonCodec.instance
  }
  
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.7.0")
  object ActivityQuery_JsonCodec extends BaboonJsonCodec.BaseGenerated[ActivityQuery, BaboonJsonCodec[ActivityQuery]] {
    def encode(ctx: BaboonCodecContext, value: ActivityQuery): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "expression" -> Json.fromString(value.expression),
        "sort" -> ActivityCollectorSort_JsonCodec.instance.encode(ctx, value.sort),
        "direction" -> SortDirection_JsonCodec.instance.encode(ctx, value.direction),
        "cursor" -> value.cursor.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "limit" -> Json.fromInt(value.limit)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityQuery] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            expression <- getField(jsonObject, "expression").flatMap(v => decodeString(v.hcursor))
            sort <- getField(jsonObject, "sort").flatMap(v => ActivityCollectorSort_JsonCodec.circeDecoder(v.hcursor))
            direction <- getField(jsonObject, "direction").flatMap(v => SortDirection_JsonCodec.circeDecoder(v.hcursor))
            cursor <- getField(jsonObject, "cursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
            limit <- getField(jsonObject, "limit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield ActivityQuery(expression,sort,direction,cursor,limit)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityQuery: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ActivityQuery.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ActivityQuery.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ActivityQuery.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityQuery]] = Lazy(ActivityQuery_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityQuery]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityQuery] = LazyInstance.value
  }
}