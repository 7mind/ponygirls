import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class RetrieveResult(
    sources: List[RetrievedSource],
    mode: RetrievalMode,
    countScope: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RetrieveResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = RetrieveResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RetrieveResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RetrieveResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RetrieveResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RetrieveResult.baboonMinReaderVersions
  }
  
  object RetrieveResult {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#RetrieveResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RetrieveResult] = RetrieveResult_JsonCodec.instance
  }
  
  object RetrieveResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[RetrieveResult, BaboonJsonCodec[RetrieveResult]] {
    def encode(ctx: BaboonCodecContext, value: RetrieveResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "sources" -> Json.fromValues(value.sources.map(e => RetrievedSource_JsonCodec.instance.encode(ctx, e))),
        "mode" -> RetrievalMode_JsonCodec.instance.encode(ctx, value.mode),
        "countScope" -> Json.fromString(value.countScope)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RetrieveResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            sources <- getField(jsonObject, "sources").flatMap(v => decodeList(RetrievedSource_JsonCodec.circeDecoder)(v.hcursor))
            mode <- getField(jsonObject, "mode").flatMap(v => RetrievalMode_JsonCodec.circeDecoder(v.hcursor))
            countScope <- getField(jsonObject, "countScope").flatMap(v => decodeString(v.hcursor))
          } yield RetrieveResult(sources,mode,countScope)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RetrieveResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RetrieveResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RetrieveResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RetrieveResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RetrieveResult]] = Lazy(RetrieveResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RetrieveResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RetrieveResult] = LazyInstance.value
  }
}