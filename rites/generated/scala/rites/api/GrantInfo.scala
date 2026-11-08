import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class GrantInfo(
    userId: String,
    login: String,
    role: GrantRole
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = GrantInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = GrantInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = GrantInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = GrantInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = GrantInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = GrantInfo.baboonMinReaderVersions
  }
  
  object GrantInfo {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#GrantInfo"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[GrantInfo] = GrantInfo_JsonCodec.instance
  }
  
  object GrantInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[GrantInfo, BaboonJsonCodec[GrantInfo]] {
    def encode(ctx: BaboonCodecContext, value: GrantInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "userId" -> Json.fromString(value.userId),
        "login" -> Json.fromString(value.login),
        "role" -> GrantRole_JsonCodec.instance.encode(ctx, value.role)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GrantInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            userId <- getField(jsonObject, "userId").flatMap(v => decodeString(v.hcursor))
            login <- getField(jsonObject, "login").flatMap(v => decodeString(v.hcursor))
            role <- getField(jsonObject, "role").flatMap(v => GrantRole_JsonCodec.circeDecoder(v.hcursor))
          } yield GrantInfo(userId,login,role)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to GrantInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = GrantInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = GrantInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = GrantInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GrantInfo]] = Lazy(GrantInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[GrantInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[GrantInfo] = LazyInstance.value
  }
}