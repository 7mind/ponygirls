import io.circe.Decoder.decodeUUID
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package chronicle.api {
  final case class ClientEnvelope(
    requestId: UUID,
    operation: Operation
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ClientEnvelope.baboonDomainVersion
    override def baboonDomainIdentifier: String = ClientEnvelope.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ClientEnvelope.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ClientEnvelope.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ClientEnvelope.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ClientEnvelope.baboonMinReaderVersions
  }
  
  object ClientEnvelope {
    def baboonDomainVersion: String = "1.4.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ClientEnvelope"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ClientEnvelope] = ClientEnvelope_JsonCodec.instance
  }
  
  object ClientEnvelope_JsonCodec extends BaboonJsonCodec.BaseGenerated[ClientEnvelope, BaboonJsonCodec[ClientEnvelope]] {
    def encode(ctx: BaboonCodecContext, value: ClientEnvelope): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "requestId" -> Json.fromString(value.requestId.toString()),
        "operation" -> Operation_JsonCodec.instance.encode(ctx, value.operation)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ClientEnvelope] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            operation <- getField(jsonObject, "operation").flatMap(v => Operation_JsonCodec.circeDecoder(v.hcursor))
          } yield ClientEnvelope(requestId,operation)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ClientEnvelope: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ClientEnvelope.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ClientEnvelope.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ClientEnvelope.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ClientEnvelope]] = Lazy(ClientEnvelope_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ClientEnvelope]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ClientEnvelope] = LazyInstance.value
  }
}