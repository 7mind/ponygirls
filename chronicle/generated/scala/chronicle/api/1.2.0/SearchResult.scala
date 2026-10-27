import io.circe.Decoder.{decodeList, decodeOption}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_2_0 {
  @deprecated("Version 1.2.0 is deprecated, you should migrate to 1.5.0")
  final case class SearchResult(
    hits: List[SearchHit],
    total: Int,
    countScope: SearchCountScope,
    rankingLimit: Option[Int]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = SearchResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = SearchResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SearchResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SearchResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SearchResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SearchResult.baboonMinReaderVersions
  }
  
  object SearchResult {
    def baboonDomainVersion: String = "1.2.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#SearchResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.2.0" -> "identical", "1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.1.0", "identical" -> "1.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[SearchResult] = SearchResult_JsonCodec.instance
  }
  
  @deprecated("Version 1.2.0 is deprecated, you should migrate to 1.5.0")
  object SearchResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[SearchResult, BaboonJsonCodec[SearchResult]] {
    def encode(ctx: BaboonCodecContext, value: SearchResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "hits" -> Json.fromValues(value.hits.map(e => SearchHit_JsonCodec.instance.encode(ctx, e))),
        "total" -> Json.fromInt(value.total),
        "countScope" -> SearchCountScope_JsonCodec.instance.encode(ctx, value.countScope),
        "rankingLimit" -> value.rankingLimit.map(v => Json.fromInt(v)).getOrElse(Json.Null)
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
            countScope <- getField(jsonObject, "countScope").flatMap(v => SearchCountScope_JsonCodec.circeDecoder(v.hcursor))
            rankingLimit <- getField(jsonObject, "rankingLimit").flatMap(v => decodeOption(BaboonJsonCodec.decodeInt)(v.hcursor))
          } yield SearchResult(hits,total,countScope,rankingLimit)
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