import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class SearchRequest(
    query: String,
    project: Option[String],
    limit: Int,
    cursor: Option[String],
    sort: SearchSort
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SearchRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = SearchRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SearchRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SearchRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SearchRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SearchRequest.baboonMinReaderVersions
  }
  
  object SearchRequest {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#SearchRequest"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SearchRequest] = SearchRequest_JsonCodec.instance
  }
  
  object SearchRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[SearchRequest, BaboonJsonCodec[SearchRequest]] {
    def encode(ctx: BaboonCodecContext, value: SearchRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "query" -> Json.fromString(value.query),
        "project" -> value.project.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "limit" -> Json.fromInt(value.limit),
        "cursor" -> value.cursor.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "sort" -> SearchSort_JsonCodec.instance.encode(ctx, value.sort)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SearchRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            query <- getField(jsonObject, "query").flatMap(v => decodeString(v.hcursor))
            project <- getField(jsonObject, "project").flatMap(v => decodeOption(decodeString)(v.hcursor))
            limit <- getField(jsonObject, "limit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            cursor <- getField(jsonObject, "cursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
            sort <- getField(jsonObject, "sort").flatMap(v => SearchSort_JsonCodec.circeDecoder(v.hcursor))
          } yield SearchRequest(query,project,limit,cursor,sort)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SearchRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SearchRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SearchRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SearchRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SearchRequest]] = Lazy(SearchRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SearchRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SearchRequest] = LazyInstance.value
  }
}