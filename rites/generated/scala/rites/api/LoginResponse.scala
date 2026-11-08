import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class LoginResponse(
    user: UserInfo,
    versions: VersionInfo,
    sessionTtlSeconds: Long
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = LoginResponse.baboonDomainVersion
    override def baboonDomainIdentifier: String = LoginResponse.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = LoginResponse.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = LoginResponse.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = LoginResponse.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = LoginResponse.baboonMinReaderVersions
  }
  
  object LoginResponse {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#LoginResponse"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[LoginResponse] = LoginResponse_JsonCodec.instance
  }
  
  object LoginResponse_JsonCodec extends BaboonJsonCodec.BaseGenerated[LoginResponse, BaboonJsonCodec[LoginResponse]] {
    def encode(ctx: BaboonCodecContext, value: LoginResponse): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "user" -> UserInfo_JsonCodec.instance.encode(ctx, value.user),
        "versions" -> VersionInfo_JsonCodec.instance.encode(ctx, value.versions),
        "sessionTtlSeconds" -> Json.fromString(value.sessionTtlSeconds.toString)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, LoginResponse] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            user <- getField(jsonObject, "user").flatMap(v => UserInfo_JsonCodec.circeDecoder(v.hcursor))
            versions <- getField(jsonObject, "versions").flatMap(v => VersionInfo_JsonCodec.circeDecoder(v.hcursor))
            sessionTtlSeconds <- getField(jsonObject, "sessionTtlSeconds").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
          } yield LoginResponse(user,versions,sessionTtlSeconds)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to LoginResponse: object expected"))
      }
    }
  
    def baboonDomainVersion: String = LoginResponse.baboonDomainVersion
    
    def baboonDomainIdentifier: String = LoginResponse.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = LoginResponse.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[LoginResponse]] = Lazy(LoginResponse_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[LoginResponse]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[LoginResponse] = LazyInstance.value
  }
}