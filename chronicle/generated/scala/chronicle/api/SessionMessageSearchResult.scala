import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class SessionMessageSearchResult(
    view: ContentView,
    hits: List[MessageSearchHit],
    nextCursor: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SessionMessageSearchResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = SessionMessageSearchResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SessionMessageSearchResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SessionMessageSearchResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SessionMessageSearchResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SessionMessageSearchResult.baboonMinReaderVersions
  }
  
  object SessionMessageSearchResult {
    def baboonDomainVersion: String = "1.7.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#SessionMessageSearchResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.6.0", "prefix-compact" -> "1.6.0", "prefix-any-mode" -> "1.6.0", "identical" -> "1.6.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SessionMessageSearchResult] = SessionMessageSearchResult_JsonCodec.instance
  }
  
  object SessionMessageSearchResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[SessionMessageSearchResult, BaboonJsonCodec[SessionMessageSearchResult]] {
    def encode(ctx: BaboonCodecContext, value: SessionMessageSearchResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "view" -> ContentView_JsonCodec.instance.encode(ctx, value.view),
        "hits" -> Json.fromValues(value.hits.map(e => MessageSearchHit_JsonCodec.instance.encode(ctx, e))),
        "nextCursor" -> value.nextCursor.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SessionMessageSearchResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            view <- getField(jsonObject, "view").flatMap(v => ContentView_JsonCodec.circeDecoder(v.hcursor))
            hits <- getField(jsonObject, "hits").flatMap(v => decodeList(MessageSearchHit_JsonCodec.circeDecoder)(v.hcursor))
            nextCursor <- getField(jsonObject, "nextCursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield SessionMessageSearchResult(view,hits,nextCursor)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SessionMessageSearchResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SessionMessageSearchResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SessionMessageSearchResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SessionMessageSearchResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SessionMessageSearchResult]] = Lazy(SessionMessageSearchResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SessionMessageSearchResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SessionMessageSearchResult] = LazyInstance.value
  }
}