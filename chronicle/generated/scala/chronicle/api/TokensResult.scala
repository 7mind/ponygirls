import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class TokensResult(
    tokens: List[ListedToken]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = TokensResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = TokensResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = TokensResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = TokensResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = TokensResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = TokensResult.baboonMinReaderVersions
  }
  
  object TokensResult {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#TokensResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[TokensResult] = TokensResult_JsonCodec.instance
  }
  
  object TokensResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[TokensResult, BaboonJsonCodec[TokensResult]] {
    def encode(ctx: BaboonCodecContext, value: TokensResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "tokens" -> Json.fromValues(value.tokens.map(e => ListedToken_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, TokensResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            tokens <- getField(jsonObject, "tokens").flatMap(v => decodeList(ListedToken_JsonCodec.circeDecoder)(v.hcursor))
          } yield TokensResult(tokens)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to TokensResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = TokensResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = TokensResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = TokensResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[TokensResult]] = Lazy(TokensResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[TokensResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[TokensResult] = LazyInstance.value
  }
}