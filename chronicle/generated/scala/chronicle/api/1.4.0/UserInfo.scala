import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_4_0 {
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.8.0")
  final case class UserInfo(
    id: String,
    login: String,
    scopes: List[Scope]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = UserInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = UserInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = UserInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = UserInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = UserInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = UserInfo.baboonMinReaderVersions
  }
  
  object UserInfo {
    def baboonDomainVersion: String = "1.4.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#UserInfo"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[UserInfo] = UserInfo_JsonCodec.instance
  }
  
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.8.0")
  object UserInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[UserInfo, BaboonJsonCodec[UserInfo]] {
    def encode(ctx: BaboonCodecContext, value: UserInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id),
        "login" -> Json.fromString(value.login),
        "scopes" -> Json.fromValues(value.scopes.map(e => Scope_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, UserInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeString(v.hcursor))
            login <- getField(jsonObject, "login").flatMap(v => decodeString(v.hcursor))
            scopes <- getField(jsonObject, "scopes").flatMap(v => decodeList(Scope_JsonCodec.circeDecoder)(v.hcursor))
          } yield UserInfo(id,login,scopes)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to UserInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = UserInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = UserInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = UserInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[UserInfo]] = Lazy(UserInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[UserInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[UserInfo] = LazyInstance.value
  }
}