import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class SourceRequest(
    scope: String,
    after: Long,
    limit: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SourceRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = SourceRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SourceRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SourceRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SourceRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SourceRequest.baboonMinReaderVersions
  }
  
  object SourceRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#SourceRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SourceRequest] = SourceRequest_JsonCodec.instance
  }
  
  object SourceRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[SourceRequest, BaboonJsonCodec[SourceRequest]] {
    def encode(ctx: BaboonCodecContext, value: SourceRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "after" -> Json.fromString(value.after.toString),
        "limit" -> Json.fromInt(value.limit)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SourceRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            after <- getField(jsonObject, "after").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            limit <- getField(jsonObject, "limit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield SourceRequest(scope,after,limit)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SourceRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SourceRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SourceRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SourceRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SourceRequest]] = Lazy(SourceRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SourceRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SourceRequest] = LazyInstance.value
  }
}