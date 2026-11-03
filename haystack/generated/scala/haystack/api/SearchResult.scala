import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class SearchResult(
    items: List[Summary],
    cursor: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SearchResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = SearchResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SearchResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SearchResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SearchResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SearchResult.baboonMinReaderVersions
  }
  
  object SearchResult {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#SearchResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SearchResult] = SearchResult_JsonCodec.instance
  }
  
  object SearchResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[SearchResult, BaboonJsonCodec[SearchResult]] {
    def encode(ctx: BaboonCodecContext, value: SearchResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "items" -> Json.fromValues(value.items.map(e => Summary_JsonCodec.instance.encode(ctx, e))),
        "cursor" -> value.cursor.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SearchResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            items <- getField(jsonObject, "items").flatMap(v => decodeList(Summary_JsonCodec.circeDecoder)(v.hcursor))
            cursor <- getField(jsonObject, "cursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield SearchResult(items,cursor)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SearchResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SearchResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SearchResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SearchResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SearchResult]] = Lazy(SearchResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SearchResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SearchResult] = LazyInstance.value
  }
}