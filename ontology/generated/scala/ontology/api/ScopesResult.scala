import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ScopesResult(
    items: List[ScopeSummary]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ScopesResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ScopesResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ScopesResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ScopesResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ScopesResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ScopesResult.baboonMinReaderVersions
  }
  
  object ScopesResult {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ScopesResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ScopesResult] = ScopesResult_JsonCodec.instance
  }
  
  object ScopesResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ScopesResult, BaboonJsonCodec[ScopesResult]] {
    def encode(ctx: BaboonCodecContext, value: ScopesResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "items" -> Json.fromValues(value.items.map(e => ScopeSummary_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ScopesResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            items <- getField(jsonObject, "items").flatMap(v => decodeList(ScopeSummary_JsonCodec.circeDecoder)(v.hcursor))
          } yield ScopesResult(items)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ScopesResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ScopesResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ScopesResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ScopesResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ScopesResult]] = Lazy(ScopesResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ScopesResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ScopesResult] = LazyInstance.value
  }
}