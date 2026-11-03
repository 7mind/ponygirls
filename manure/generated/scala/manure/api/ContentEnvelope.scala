import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package manure.api {
  final case class ContentEnvelope(
    requestId: UUID,
    apiVersion: String,
    command: ContentCommand
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ContentEnvelope.baboonDomainVersion
    override def baboonDomainIdentifier: String = ContentEnvelope.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ContentEnvelope.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ContentEnvelope.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ContentEnvelope.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ContentEnvelope.baboonMinReaderVersions
  }
  
  object ContentEnvelope {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#ContentEnvelope"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ContentEnvelope] = ContentEnvelope_JsonCodec.instance
  }
  
  object ContentEnvelope_JsonCodec extends BaboonJsonCodec.BaseGenerated[ContentEnvelope, BaboonJsonCodec[ContentEnvelope]] {
    def encode(ctx: BaboonCodecContext, value: ContentEnvelope): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "requestId" -> Json.fromString(value.requestId.toString()),
        "apiVersion" -> Json.fromString(value.apiVersion),
        "command" -> ContentCommand_JsonCodec.instance.encode(ctx, value.command)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentEnvelope] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            apiVersion <- getField(jsonObject, "apiVersion").flatMap(v => decodeString(v.hcursor))
            command <- getField(jsonObject, "command").flatMap(v => ContentCommand_JsonCodec.circeDecoder(v.hcursor))
          } yield ContentEnvelope(requestId,apiVersion,command)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ContentEnvelope: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ContentEnvelope.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ContentEnvelope.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ContentEnvelope.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentEnvelope]] = Lazy(ContentEnvelope_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentEnvelope]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ContentEnvelope] = LazyInstance.value
  }
}