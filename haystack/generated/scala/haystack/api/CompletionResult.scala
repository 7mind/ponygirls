import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class CompletionResult(
    suggestions: List[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CompletionResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = CompletionResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CompletionResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CompletionResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CompletionResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CompletionResult.baboonMinReaderVersions
  }
  
  object CompletionResult {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#CompletionResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CompletionResult] = CompletionResult_JsonCodec.instance
  }
  
  object CompletionResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[CompletionResult, BaboonJsonCodec[CompletionResult]] {
    def encode(ctx: BaboonCodecContext, value: CompletionResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "suggestions" -> Json.fromValues(value.suggestions.map(e => Json.fromString(e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CompletionResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            suggestions <- getField(jsonObject, "suggestions").flatMap(v => decodeList(decodeString)(v.hcursor))
          } yield CompletionResult(suggestions)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CompletionResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CompletionResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CompletionResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CompletionResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CompletionResult]] = Lazy(CompletionResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CompletionResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CompletionResult] = LazyInstance.value
  }
}