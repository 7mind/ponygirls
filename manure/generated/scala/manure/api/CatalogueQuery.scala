import io.circe.Decoder.{decodeBoolean, decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class CatalogueQuery(
    query: String,
    includeExpired: Boolean,
    visibility: Option[Visibility],
    state: Option[ArtifactState],
    sort: CatalogueSort,
    direction: SortDirection,
    limit: Int,
    cursor: Option[String],
    tags: List[String],
    hostname: Option[String],
    projectPath: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CatalogueQuery.baboonDomainVersion
    override def baboonDomainIdentifier: String = CatalogueQuery.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CatalogueQuery.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CatalogueQuery.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CatalogueQuery.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CatalogueQuery.baboonMinReaderVersions
  }
  
  object CatalogueQuery {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#CatalogueQuery"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CatalogueQuery] = CatalogueQuery_JsonCodec.instance
  }
  
  object CatalogueQuery_JsonCodec extends BaboonJsonCodec.BaseGenerated[CatalogueQuery, BaboonJsonCodec[CatalogueQuery]] {
    def encode(ctx: BaboonCodecContext, value: CatalogueQuery): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "query" -> Json.fromString(value.query),
        "includeExpired" -> Json.fromBoolean(value.includeExpired),
        "visibility" -> value.visibility.map(v => Visibility_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "state" -> value.state.map(v => ArtifactState_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "sort" -> CatalogueSort_JsonCodec.instance.encode(ctx, value.sort),
        "direction" -> SortDirection_JsonCodec.instance.encode(ctx, value.direction),
        "limit" -> Json.fromInt(value.limit),
        "cursor" -> value.cursor.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "tags" -> Json.fromValues(value.tags.map(e => Json.fromString(e))),
        "hostname" -> value.hostname.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "projectPath" -> value.projectPath.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CatalogueQuery] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            query <- getField(jsonObject, "query").flatMap(v => decodeString(v.hcursor))
            includeExpired <- getField(jsonObject, "includeExpired").flatMap(v => decodeBoolean(v.hcursor))
            visibility <- getField(jsonObject, "visibility").flatMap(v => decodeOption(Visibility_JsonCodec.circeDecoder)(v.hcursor))
            state <- getField(jsonObject, "state").flatMap(v => decodeOption(ArtifactState_JsonCodec.circeDecoder)(v.hcursor))
            sort <- getField(jsonObject, "sort").flatMap(v => CatalogueSort_JsonCodec.circeDecoder(v.hcursor))
            direction <- getField(jsonObject, "direction").flatMap(v => SortDirection_JsonCodec.circeDecoder(v.hcursor))
            limit <- getField(jsonObject, "limit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            cursor <- getField(jsonObject, "cursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
            tags <- getField(jsonObject, "tags").flatMap(v => decodeList(decodeString)(v.hcursor))
            hostname <- getField(jsonObject, "hostname").flatMap(v => decodeOption(decodeString)(v.hcursor))
            projectPath <- getField(jsonObject, "projectPath").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield CatalogueQuery(query,includeExpired,visibility,state,sort,direction,limit,cursor,tags,hostname,projectPath)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CatalogueQuery: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CatalogueQuery.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CatalogueQuery.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CatalogueQuery.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CatalogueQuery]] = Lazy(CatalogueQuery_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CatalogueQuery]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CatalogueQuery] = LazyInstance.value
  }
}