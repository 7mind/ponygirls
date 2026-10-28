import io.circe.Decoder.{decodeBoolean, decodeList, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}
import java.util.UUID

package chronicle.api.v1_3_0 {
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.7.0")
  final case class TokenInfo(
    id: UUID,
    name: String,
    scopes: List[Scope],
    createdAt: String,
    revoked: Boolean
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = TokenInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = TokenInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = TokenInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = TokenInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = TokenInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = TokenInfo.baboonMinReaderVersions
  }
  
  object TokenInfo {
    def baboonDomainVersion: String = "1.3.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#TokenInfo"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[TokenInfo] = TokenInfo_JsonCodec.instance
  }
  
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.7.0")
  object TokenInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[TokenInfo, BaboonJsonCodec[TokenInfo]] {
    def encode(ctx: BaboonCodecContext, value: TokenInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "name" -> Json.fromString(value.name),
        "scopes" -> Json.fromValues(value.scopes.map(e => Scope_JsonCodec.instance.encode(ctx, e))),
        "createdAt" -> Json.fromString(value.createdAt),
        "revoked" -> Json.fromBoolean(value.revoked)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, TokenInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            name <- getField(jsonObject, "name").flatMap(v => decodeString(v.hcursor))
            scopes <- getField(jsonObject, "scopes").flatMap(v => decodeList(Scope_JsonCodec.circeDecoder)(v.hcursor))
            createdAt <- getField(jsonObject, "createdAt").flatMap(v => decodeString(v.hcursor))
            revoked <- getField(jsonObject, "revoked").flatMap(v => decodeBoolean(v.hcursor))
          } yield TokenInfo(id,name,scopes,createdAt,revoked)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to TokenInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = TokenInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = TokenInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = TokenInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[TokenInfo]] = Lazy(TokenInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[TokenInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[TokenInfo] = LazyInstance.value
  }
}