import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class UserInfo(
    id: String,
    login: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = UserInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = UserInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = UserInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = UserInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = UserInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = UserInfo.baboonMinReaderVersions
  }
  
  object UserInfo {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#UserInfo"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[UserInfo] = UserInfo_JsonCodec.instance
  }
  
  object UserInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[UserInfo, BaboonJsonCodec[UserInfo]] {
    def encode(ctx: BaboonCodecContext, value: UserInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id),
        "login" -> Json.fromString(value.login)
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
          } yield UserInfo(id,login)
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