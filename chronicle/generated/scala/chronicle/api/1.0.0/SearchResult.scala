import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_0_0 {
  @deprecated("Version 1.0.0 is deprecated, you should migrate to 1.8.0")
  final case class SearchResult(
    hits: List[SearchHit],
    total: Int
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = SearchResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = SearchResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SearchResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SearchResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SearchResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SearchResult.baboonMinReaderVersions
  }
  
  object SearchResult {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#SearchResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical", "1.1.0" -> "prefix-compact", "1.2.0" -> "prefix-compact", "1.3.0" -> "prefix-compact", "1.4.0" -> "prefix-compact", "1.5.0" -> "prefix-compact", "1.6.0" -> "prefix-compact", "1.7.0" -> "prefix-compact", "1.8.0" -> "prefix-compact")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[SearchResult] = SearchResult_JsonCodec.instance
  }
  
  @deprecated("Version 1.0.0 is deprecated, you should migrate to 1.8.0")
  object SearchResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[SearchResult, BaboonJsonCodec[SearchResult]] {
    def encode(ctx: BaboonCodecContext, value: SearchResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "hits" -> Json.fromValues(value.hits.map(e => SearchHit_JsonCodec.instance.encode(ctx, e))),
        "total" -> Json.fromInt(value.total)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SearchResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            hits <- getField(jsonObject, "hits").flatMap(v => decodeList(SearchHit_JsonCodec.circeDecoder)(v.hcursor))
            total <- getField(jsonObject, "total").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield SearchResult(hits,total)
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