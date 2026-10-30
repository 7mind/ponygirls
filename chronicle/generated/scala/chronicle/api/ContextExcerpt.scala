import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ContextExcerpt(
    source: PassageSourceSpan,
    role: String,
    text: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ContextExcerpt.baboonDomainVersion
    override def baboonDomainIdentifier: String = ContextExcerpt.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ContextExcerpt.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ContextExcerpt.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ContextExcerpt.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ContextExcerpt.baboonMinReaderVersions
  }
  
  object ContextExcerpt {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ContextExcerpt"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ContextExcerpt] = ContextExcerpt_JsonCodec.instance
  }
  
  object ContextExcerpt_JsonCodec extends BaboonJsonCodec.BaseGenerated[ContextExcerpt, BaboonJsonCodec[ContextExcerpt]] {
    def encode(ctx: BaboonCodecContext, value: ContextExcerpt): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "source" -> PassageSourceSpan_JsonCodec.instance.encode(ctx, value.source),
        "role" -> Json.fromString(value.role),
        "text" -> Json.fromString(value.text)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContextExcerpt] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            source <- getField(jsonObject, "source").flatMap(v => PassageSourceSpan_JsonCodec.circeDecoder(v.hcursor))
            role <- getField(jsonObject, "role").flatMap(v => decodeString(v.hcursor))
            text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
          } yield ContextExcerpt(source,role,text)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ContextExcerpt: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ContextExcerpt.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ContextExcerpt.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ContextExcerpt.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContextExcerpt]] = Lazy(ContextExcerpt_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ContextExcerpt]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ContextExcerpt] = LazyInstance.value
  }
}