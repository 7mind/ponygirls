import io.circe.Decoder.decodeUUID
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}
import java.util.UUID

package chronicle.api.v1_4_0 {
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.5.0")
  final case class ServerEnvelope(
    requestId: UUID,
    result: Result
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = ServerEnvelope.baboonDomainVersion
    override def baboonDomainIdentifier: String = ServerEnvelope.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ServerEnvelope.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ServerEnvelope.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ServerEnvelope.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ServerEnvelope.baboonMinReaderVersions
  }
  
  object ServerEnvelope {
    def baboonDomainVersion: String = "1.4.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ServerEnvelope"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical", "1.5.0" -> "json-additive")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[ServerEnvelope] = ServerEnvelope_JsonCodec.instance
  }
  
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.5.0")
  object ServerEnvelope_JsonCodec extends BaboonJsonCodec.BaseGenerated[ServerEnvelope, BaboonJsonCodec[ServerEnvelope]] {
    def encode(ctx: BaboonCodecContext, value: ServerEnvelope): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "requestId" -> Json.fromString(value.requestId.toString()),
        "result" -> Result_JsonCodec.instance.encode(ctx, value.result)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ServerEnvelope] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            result <- getField(jsonObject, "result").flatMap(v => Result_JsonCodec.circeDecoder(v.hcursor))
          } yield ServerEnvelope(requestId,result)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ServerEnvelope: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ServerEnvelope.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ServerEnvelope.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ServerEnvelope.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ServerEnvelope]] = Lazy(ServerEnvelope_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ServerEnvelope]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ServerEnvelope] = LazyInstance.value
  }
}