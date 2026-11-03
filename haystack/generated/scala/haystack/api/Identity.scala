import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class Identity(
    userId: String,
    userType: String,
    tokenId: String,
    activityProjectId: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Identity.baboonDomainVersion
    override def baboonDomainIdentifier: String = Identity.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Identity.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Identity.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Identity.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Identity.baboonMinReaderVersions
  }
  
  object Identity {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#Identity"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Identity] = Identity_JsonCodec.instance
  }
  
  object Identity_JsonCodec extends BaboonJsonCodec.BaseGenerated[Identity, BaboonJsonCodec[Identity]] {
    def encode(ctx: BaboonCodecContext, value: Identity): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "userId" -> Json.fromString(value.userId),
        "userType" -> Json.fromString(value.userType),
        "tokenId" -> Json.fromString(value.tokenId),
        "activityProjectId" -> Json.fromString(value.activityProjectId)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Identity] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            userId <- getField(jsonObject, "userId").flatMap(v => decodeString(v.hcursor))
            userType <- getField(jsonObject, "userType").flatMap(v => decodeString(v.hcursor))
            tokenId <- getField(jsonObject, "tokenId").flatMap(v => decodeString(v.hcursor))
            activityProjectId <- getField(jsonObject, "activityProjectId").flatMap(v => decodeString(v.hcursor))
          } yield Identity(userId,userType,tokenId,activityProjectId)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Identity: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Identity.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Identity.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Identity.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Identity]] = Lazy(Identity_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Identity]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Identity] = LazyInstance.value
  }
}