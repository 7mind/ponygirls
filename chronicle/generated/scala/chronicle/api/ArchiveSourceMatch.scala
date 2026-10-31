import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ArchiveSourceMatch(
    view: ContentView,
    span: Span,
    kind: ArchiveMatchKind,
    operand: String,
    summary: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ArchiveSourceMatch.baboonDomainVersion
    override def baboonDomainIdentifier: String = ArchiveSourceMatch.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ArchiveSourceMatch.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ArchiveSourceMatch.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ArchiveSourceMatch.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ArchiveSourceMatch.baboonMinReaderVersions
  }
  
  object ArchiveSourceMatch {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ArchiveSourceMatch"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ArchiveSourceMatch] = ArchiveSourceMatch_JsonCodec.instance
  }
  
  object ArchiveSourceMatch_JsonCodec extends BaboonJsonCodec.BaseGenerated[ArchiveSourceMatch, BaboonJsonCodec[ArchiveSourceMatch]] {
    def encode(ctx: BaboonCodecContext, value: ArchiveSourceMatch): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "view" -> ContentView_JsonCodec.instance.encode(ctx, value.view),
        "span" -> Span_JsonCodec.instance.encode(ctx, value.span),
        "kind" -> ArchiveMatchKind_JsonCodec.instance.encode(ctx, value.kind),
        "operand" -> Json.fromString(value.operand),
        "summary" -> value.summary.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ArchiveSourceMatch] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            view <- getField(jsonObject, "view").flatMap(v => ContentView_JsonCodec.circeDecoder(v.hcursor))
            span <- getField(jsonObject, "span").flatMap(v => Span_JsonCodec.circeDecoder(v.hcursor))
            kind <- getField(jsonObject, "kind").flatMap(v => ArchiveMatchKind_JsonCodec.circeDecoder(v.hcursor))
            operand <- getField(jsonObject, "operand").flatMap(v => decodeString(v.hcursor))
            summary <- getField(jsonObject, "summary").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield ArchiveSourceMatch(view,span,kind,operand,summary)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ArchiveSourceMatch: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ArchiveSourceMatch.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ArchiveSourceMatch.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ArchiveSourceMatch.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ArchiveSourceMatch]] = Lazy(ArchiveSourceMatch_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ArchiveSourceMatch]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ArchiveSourceMatch] = LazyInstance.value
  }
}