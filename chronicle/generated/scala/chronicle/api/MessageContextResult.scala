import io.circe.Decoder.{decodeList, decodeOption, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package chronicle.api {
  final case class MessageContextResult(
    sessionId: UUID,
    view: ContentView,
    anchor: PassageSourceSpan,
    excerpts: List[ContextExcerpt],
    previous: Option[Span],
    next: Option[Span]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = MessageContextResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = MessageContextResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = MessageContextResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = MessageContextResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = MessageContextResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = MessageContextResult.baboonMinReaderVersions
  }
  
  object MessageContextResult {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#MessageContextResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[MessageContextResult] = MessageContextResult_JsonCodec.instance
  }
  
  object MessageContextResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[MessageContextResult, BaboonJsonCodec[MessageContextResult]] {
    def encode(ctx: BaboonCodecContext, value: MessageContextResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "sessionId" -> Json.fromString(value.sessionId.toString()),
        "view" -> ContentView_JsonCodec.instance.encode(ctx, value.view),
        "anchor" -> PassageSourceSpan_JsonCodec.instance.encode(ctx, value.anchor),
        "excerpts" -> Json.fromValues(value.excerpts.map(e => ContextExcerpt_JsonCodec.instance.encode(ctx, e))),
        "previous" -> value.previous.map(v => Span_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "next" -> value.next.map(v => Span_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, MessageContextResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeUUID(v.hcursor))
            view <- getField(jsonObject, "view").flatMap(v => ContentView_JsonCodec.circeDecoder(v.hcursor))
            anchor <- getField(jsonObject, "anchor").flatMap(v => PassageSourceSpan_JsonCodec.circeDecoder(v.hcursor))
            excerpts <- getField(jsonObject, "excerpts").flatMap(v => decodeList(ContextExcerpt_JsonCodec.circeDecoder)(v.hcursor))
            previous <- getField(jsonObject, "previous").flatMap(v => decodeOption(Span_JsonCodec.circeDecoder)(v.hcursor))
            next <- getField(jsonObject, "next").flatMap(v => decodeOption(Span_JsonCodec.circeDecoder)(v.hcursor))
          } yield MessageContextResult(sessionId,view,anchor,excerpts,previous,next)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to MessageContextResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = MessageContextResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = MessageContextResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = MessageContextResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[MessageContextResult]] = Lazy(MessageContextResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[MessageContextResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[MessageContextResult] = LazyInstance.value
  }
}