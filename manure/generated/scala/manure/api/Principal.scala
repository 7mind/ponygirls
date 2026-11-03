import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class Principal(
    userId: String,
    tokenId: String,
    principalType: PrincipalType
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Principal.baboonDomainVersion
    override def baboonDomainIdentifier: String = Principal.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Principal.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Principal.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Principal.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Principal.baboonMinReaderVersions
  }
  
  object Principal {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#Principal"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Principal] = Principal_JsonCodec.instance
  }
  
  object Principal_JsonCodec extends BaboonJsonCodec.BaseGenerated[Principal, BaboonJsonCodec[Principal]] {
    def encode(ctx: BaboonCodecContext, value: Principal): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "userId" -> Json.fromString(value.userId),
        "tokenId" -> Json.fromString(value.tokenId),
        "principalType" -> PrincipalType_JsonCodec.instance.encode(ctx, value.principalType)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Principal] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            userId <- getField(jsonObject, "userId").flatMap(v => decodeString(v.hcursor))
            tokenId <- getField(jsonObject, "tokenId").flatMap(v => decodeString(v.hcursor))
            principalType <- getField(jsonObject, "principalType").flatMap(v => PrincipalType_JsonCodec.circeDecoder(v.hcursor))
          } yield Principal(userId,tokenId,principalType)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Principal: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Principal.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Principal.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Principal.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Principal]] = Lazy(Principal_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Principal]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Principal] = LazyInstance.value
  }
}