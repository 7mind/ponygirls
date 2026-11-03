import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class SearchPage(
    hits: List[SearchHit],
    total: Long,
    countScope: SearchCountScope,
    rankingLimit: Option[Int],
    nextCursor: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SearchPage.baboonDomainVersion
    override def baboonDomainIdentifier: String = SearchPage.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SearchPage.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SearchPage.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SearchPage.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SearchPage.baboonMinReaderVersions
  }
  
  object SearchPage {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#SearchPage"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SearchPage] = SearchPage_JsonCodec.instance
  }
  
  object SearchPage_JsonCodec extends BaboonJsonCodec.BaseGenerated[SearchPage, BaboonJsonCodec[SearchPage]] {
    def encode(ctx: BaboonCodecContext, value: SearchPage): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "hits" -> Json.fromValues(value.hits.map(e => SearchHit_JsonCodec.instance.encode(ctx, e))),
        "total" -> Json.fromString(value.total.toString),
        "countScope" -> SearchCountScope_JsonCodec.instance.encode(ctx, value.countScope),
        "rankingLimit" -> value.rankingLimit.map(v => Json.fromInt(v)).getOrElse(Json.Null),
        "nextCursor" -> value.nextCursor.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SearchPage] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            hits <- getField(jsonObject, "hits").flatMap(v => decodeList(SearchHit_JsonCodec.circeDecoder)(v.hcursor))
            total <- getField(jsonObject, "total").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            countScope <- getField(jsonObject, "countScope").flatMap(v => SearchCountScope_JsonCodec.circeDecoder(v.hcursor))
            rankingLimit <- getField(jsonObject, "rankingLimit").flatMap(v => decodeOption(BaboonJsonCodec.decodeInt)(v.hcursor))
            nextCursor <- getField(jsonObject, "nextCursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield SearchPage(hits,total,countScope,rankingLimit,nextCursor)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SearchPage: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SearchPage.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SearchPage.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SearchPage.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SearchPage]] = Lazy(SearchPage_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SearchPage]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SearchPage] = LazyInstance.value
  }
}