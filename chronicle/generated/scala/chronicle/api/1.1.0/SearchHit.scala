import io.circe.Decoder.{decodeDouble, decodeList}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_1_0 {
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.3.0")
  final case class SearchHit(
    session: SessionInfo,
    chunks: List[Chunk],
    score: Double
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = SearchHit.baboonDomainVersion
    override def baboonDomainIdentifier: String = SearchHit.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SearchHit.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SearchHit.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SearchHit.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SearchHit.baboonMinReaderVersions
  }
  
  object SearchHit {
    def baboonDomainVersion: String = "1.1.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#SearchHit"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical", "1.2.0" -> "identical", "1.3.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[SearchHit] = SearchHit_JsonCodec.instance
  }
  
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.3.0")
  object SearchHit_JsonCodec extends BaboonJsonCodec.BaseGenerated[SearchHit, BaboonJsonCodec[SearchHit]] {
    def encode(ctx: BaboonCodecContext, value: SearchHit): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "session" -> SessionInfo_JsonCodec.instance.encode(ctx, value.session),
        "chunks" -> Json.fromValues(value.chunks.map(e => Chunk_JsonCodec.instance.encode(ctx, e))),
        "score" -> Json.fromDouble(value.score).get
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SearchHit] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            session <- getField(jsonObject, "session").flatMap(v => SessionInfo_JsonCodec.circeDecoder(v.hcursor))
            chunks <- getField(jsonObject, "chunks").flatMap(v => decodeList(Chunk_JsonCodec.circeDecoder)(v.hcursor))
            score <- getField(jsonObject, "score").flatMap(v => decodeDouble(v.hcursor))
          } yield SearchHit(session,chunks,score)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SearchHit: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SearchHit.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SearchHit.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SearchHit.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SearchHit]] = Lazy(SearchHit_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SearchHit]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SearchHit] = LazyInstance.value
  }
}