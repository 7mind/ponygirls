import io.circe.Decoder.{decodeDouble, decodeList, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package chronicle.api {
  final case class Chunk(
    id: UUID,
    sessionId: UUID,
    text: String,
    summary: String,
    tags: List[String],
    spans: List[Span],
    score: Double
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Chunk.baboonDomainVersion
    override def baboonDomainIdentifier: String = Chunk.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Chunk.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Chunk.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Chunk.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Chunk.baboonMinReaderVersions
  }
  
  object Chunk {
    def baboonDomainVersion: String = "1.7.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#Chunk"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Chunk] = Chunk_JsonCodec.instance
  }
  
  object Chunk_JsonCodec extends BaboonJsonCodec.BaseGenerated[Chunk, BaboonJsonCodec[Chunk]] {
    def encode(ctx: BaboonCodecContext, value: Chunk): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "sessionId" -> Json.fromString(value.sessionId.toString()),
        "text" -> Json.fromString(value.text),
        "summary" -> Json.fromString(value.summary),
        "tags" -> Json.fromValues(value.tags.map(e => Json.fromString(e))),
        "spans" -> Json.fromValues(value.spans.map(e => Span_JsonCodec.instance.encode(ctx, e))),
        "score" -> Json.fromDouble(value.score).get
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Chunk] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeUUID(v.hcursor))
            text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
            summary <- getField(jsonObject, "summary").flatMap(v => decodeString(v.hcursor))
            tags <- getField(jsonObject, "tags").flatMap(v => decodeList(decodeString)(v.hcursor))
            spans <- getField(jsonObject, "spans").flatMap(v => decodeList(Span_JsonCodec.circeDecoder)(v.hcursor))
            score <- getField(jsonObject, "score").flatMap(v => decodeDouble(v.hcursor))
          } yield Chunk(id,sessionId,text,summary,tags,spans,score)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Chunk: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Chunk.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Chunk.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Chunk.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Chunk]] = Lazy(Chunk_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Chunk]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Chunk] = LazyInstance.value
  }
}