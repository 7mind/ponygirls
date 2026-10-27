import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_4_0 {
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.5.0")
  final case class SearchQuery(
    query: String,
    mode: SearchMode,
    filter: SearchFilter,
    limit: Int,
    offset: Int
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = SearchQuery.baboonDomainVersion
    override def baboonDomainIdentifier: String = SearchQuery.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SearchQuery.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SearchQuery.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SearchQuery.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SearchQuery.baboonMinReaderVersions
  }
  
  object SearchQuery {
    def baboonDomainVersion: String = "1.4.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#SearchQuery"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical", "1.5.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[SearchQuery] = SearchQuery_JsonCodec.instance
  }
  
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.5.0")
  object SearchQuery_JsonCodec extends BaboonJsonCodec.BaseGenerated[SearchQuery, BaboonJsonCodec[SearchQuery]] {
    def encode(ctx: BaboonCodecContext, value: SearchQuery): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "query" -> Json.fromString(value.query),
        "mode" -> SearchMode_JsonCodec.instance.encode(ctx, value.mode),
        "filter" -> SearchFilter_JsonCodec.instance.encode(ctx, value.filter),
        "limit" -> Json.fromInt(value.limit),
        "offset" -> Json.fromInt(value.offset)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SearchQuery] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            query <- getField(jsonObject, "query").flatMap(v => decodeString(v.hcursor))
            mode <- getField(jsonObject, "mode").flatMap(v => SearchMode_JsonCodec.circeDecoder(v.hcursor))
            filter <- getField(jsonObject, "filter").flatMap(v => SearchFilter_JsonCodec.circeDecoder(v.hcursor))
            limit <- getField(jsonObject, "limit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            offset <- getField(jsonObject, "offset").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield SearchQuery(query,mode,filter,limit,offset)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SearchQuery: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SearchQuery.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SearchQuery.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SearchQuery.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SearchQuery]] = Lazy(SearchQuery_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SearchQuery]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SearchQuery] = LazyInstance.value
  }
}