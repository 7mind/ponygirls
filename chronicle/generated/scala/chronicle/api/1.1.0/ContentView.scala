import io.circe.Decoder.{decodeOption, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}
import java.util.UUID

package chronicle.api.v1_1_0 {
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.2.0")
  final case class ContentView(
    revision: Int,
    generationId: Option[UUID]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = ContentView.baboonDomainVersion
    override def baboonDomainIdentifier: String = ContentView.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ContentView.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ContentView.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ContentView.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ContentView.baboonMinReaderVersions
  }
  
  object ContentView {
    def baboonDomainVersion: String = "1.1.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ContentView"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical", "1.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[ContentView] = ContentView_JsonCodec.instance
  }
  
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.2.0")
  object ContentView_JsonCodec extends BaboonJsonCodec.BaseGenerated[ContentView, BaboonJsonCodec[ContentView]] {
    def encode(ctx: BaboonCodecContext, value: ContentView): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "revision" -> Json.fromInt(value.revision),
        "generationId" -> value.generationId.map(v => Json.fromString(v.toString())).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentView] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            generationId <- getField(jsonObject, "generationId").flatMap(v => decodeOption(decodeUUID)(v.hcursor))
          } yield ContentView(revision,generationId)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ContentView: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ContentView.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ContentView.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ContentView.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentView]] = Lazy(ContentView_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentView]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ContentView] = LazyInstance.value
  }
}