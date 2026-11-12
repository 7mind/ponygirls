import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class RequestTrace(
    hostRequestId: UUID,
    operation: String,
    transport: RequestTransport
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RequestTrace.baboonDomainVersion
    override def baboonDomainIdentifier: String = RequestTrace.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RequestTrace.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RequestTrace.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RequestTrace.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RequestTrace.baboonMinReaderVersions
  }
  
  object RequestTrace {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#RequestTrace"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RequestTrace] = RequestTrace_JsonCodec.instance
  }
  
  object RequestTrace_JsonCodec extends BaboonJsonCodec.BaseGenerated[RequestTrace, BaboonJsonCodec[RequestTrace]] {
    def encode(ctx: BaboonCodecContext, value: RequestTrace): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "hostRequestId" -> Json.fromString(value.hostRequestId.toString()),
        "operation" -> Json.fromString(value.operation),
        "transport" -> RequestTransport_JsonCodec.instance.encode(ctx, value.transport)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RequestTrace] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            hostRequestId <- getField(jsonObject, "hostRequestId").flatMap(v => decodeUUID(v.hcursor))
            operation <- getField(jsonObject, "operation").flatMap(v => decodeString(v.hcursor))
            transport <- getField(jsonObject, "transport").flatMap(v => RequestTransport_JsonCodec.circeDecoder(v.hcursor))
          } yield RequestTrace(hostRequestId,operation,transport)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RequestTrace: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RequestTrace.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RequestTrace.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RequestTrace.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RequestTrace]] = Lazy(RequestTrace_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RequestTrace]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RequestTrace] = LazyInstance.value
  }
}