import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_1_0 {
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.8.0")
  final case class LoginResponse(
    user: UserInfo,
    versions: VersionInfo
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = LoginResponse.baboonDomainVersion
    override def baboonDomainIdentifier: String = LoginResponse.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = LoginResponse.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = LoginResponse.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = LoginResponse.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = LoginResponse.baboonMinReaderVersions
  }
  
  object LoginResponse {
    def baboonDomainVersion: String = "1.1.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#LoginResponse"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical", "1.2.0" -> "identical", "1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[LoginResponse] = LoginResponse_JsonCodec.instance
  }
  
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.8.0")
  object LoginResponse_JsonCodec extends BaboonJsonCodec.BaseGenerated[LoginResponse, BaboonJsonCodec[LoginResponse]] {
    def encode(ctx: BaboonCodecContext, value: LoginResponse): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "user" -> UserInfo_JsonCodec.instance.encode(ctx, value.user),
        "versions" -> VersionInfo_JsonCodec.instance.encode(ctx, value.versions)
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
          } yield LoginResponse(user,versions)
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