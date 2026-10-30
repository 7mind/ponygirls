import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_0_0 {
  @deprecated("Version 1.0.0 is deprecated, you should migrate to 1.8.0")
  final case class TokenResult(
    token: TokenInfo,
    secret: Option[String]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = TokenResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = TokenResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = TokenResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = TokenResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = TokenResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = TokenResult.baboonMinReaderVersions
  }
  
  object TokenResult {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#TokenResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical", "1.1.0" -> "identical", "1.2.0" -> "identical", "1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[TokenResult] = TokenResult_JsonCodec.instance
  }
  
  @deprecated("Version 1.0.0 is deprecated, you should migrate to 1.8.0")
  object TokenResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[TokenResult, BaboonJsonCodec[TokenResult]] {
    def encode(ctx: BaboonCodecContext, value: TokenResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "token" -> TokenInfo_JsonCodec.instance.encode(ctx, value.token),
        "secret" -> value.secret.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, TokenResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            token <- getField(jsonObject, "token").flatMap(v => TokenInfo_JsonCodec.circeDecoder(v.hcursor))
            secret <- getField(jsonObject, "secret").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield TokenResult(token,secret)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to TokenResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = TokenResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = TokenResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = TokenResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[TokenResult]] = Lazy(TokenResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[TokenResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[TokenResult] = LazyInstance.value
  }
}