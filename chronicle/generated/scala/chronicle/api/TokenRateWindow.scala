import io.circe.Decoder.{decodeDouble, decodeOption}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class TokenRateWindow(
    knownTokens: Long,
    reportedCalls: Long,
    unknownCalls: Long,
    tokensPerSecond: Option[Double],
    sampleAgeMillis: Option[Long]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = TokenRateWindow.baboonDomainVersion
    override def baboonDomainIdentifier: String = TokenRateWindow.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = TokenRateWindow.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = TokenRateWindow.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = TokenRateWindow.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = TokenRateWindow.baboonMinReaderVersions
  }
  
  object TokenRateWindow {
    def baboonDomainVersion: String = "1.8.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#TokenRateWindow"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[TokenRateWindow] = TokenRateWindow_JsonCodec.instance
  }
  
  object TokenRateWindow_JsonCodec extends BaboonJsonCodec.BaseGenerated[TokenRateWindow, BaboonJsonCodec[TokenRateWindow]] {
    def encode(ctx: BaboonCodecContext, value: TokenRateWindow): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "knownTokens" -> Json.fromString(value.knownTokens.toString),
        "reportedCalls" -> Json.fromString(value.reportedCalls.toString),
        "unknownCalls" -> Json.fromString(value.unknownCalls.toString),
        "tokensPerSecond" -> value.tokensPerSecond.map(v => Json.fromDouble(v).get).getOrElse(Json.Null),
        "sampleAgeMillis" -> value.sampleAgeMillis.map(v => Json.fromString(v.toString)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, TokenRateWindow] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            knownTokens <- getField(jsonObject, "knownTokens").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            reportedCalls <- getField(jsonObject, "reportedCalls").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            unknownCalls <- getField(jsonObject, "unknownCalls").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            tokensPerSecond <- getField(jsonObject, "tokensPerSecond").flatMap(v => decodeOption(decodeDouble)(v.hcursor))
            sampleAgeMillis <- getField(jsonObject, "sampleAgeMillis").flatMap(v => decodeOption(BaboonJsonCodec.decodeLong)(v.hcursor))
          } yield TokenRateWindow(knownTokens,reportedCalls,unknownCalls,tokensPerSecond,sampleAgeMillis)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to TokenRateWindow: object expected"))
      }
    }
  
    def baboonDomainVersion: String = TokenRateWindow.baboonDomainVersion
    
    def baboonDomainIdentifier: String = TokenRateWindow.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = TokenRateWindow.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[TokenRateWindow]] = Lazy(TokenRateWindow_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[TokenRateWindow]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[TokenRateWindow] = LazyInstance.value
  }
}