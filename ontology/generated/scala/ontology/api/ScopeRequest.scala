import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ScopeRequest(
    scope: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ScopeRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = ScopeRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ScopeRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ScopeRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ScopeRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ScopeRequest.baboonMinReaderVersions
  }
  
  object ScopeRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ScopeRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ScopeRequest] = ScopeRequest_JsonCodec.instance
  }
  
  object ScopeRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[ScopeRequest, BaboonJsonCodec[ScopeRequest]] {
    def encode(ctx: BaboonCodecContext, value: ScopeRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ScopeRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
          } yield ScopeRequest(scope)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ScopeRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ScopeRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ScopeRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ScopeRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ScopeRequest]] = Lazy(ScopeRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ScopeRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ScopeRequest] = LazyInstance.value
  }
}