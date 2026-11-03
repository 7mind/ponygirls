import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class LoginRequest(
    token: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = LoginRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = LoginRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = LoginRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = LoginRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = LoginRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = LoginRequest.baboonMinReaderVersions
  }
  
  object LoginRequest {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#LoginRequest"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[LoginRequest] = LoginRequest_JsonCodec.instance
  }
  
  object LoginRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[LoginRequest, BaboonJsonCodec[LoginRequest]] {
    def encode(ctx: BaboonCodecContext, value: LoginRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "token" -> Json.fromString(value.token)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, LoginRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            token <- getField(jsonObject, "token").flatMap(v => decodeString(v.hcursor))
          } yield LoginRequest(token)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to LoginRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = LoginRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = LoginRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = LoginRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[LoginRequest]] = Lazy(LoginRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[LoginRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[LoginRequest] = LazyInstance.value
  }
}