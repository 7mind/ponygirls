import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class RetrievalCapabilities(
    modes: List[RetrievalMode]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RetrievalCapabilities.baboonDomainVersion
    override def baboonDomainIdentifier: String = RetrievalCapabilities.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RetrievalCapabilities.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RetrievalCapabilities.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RetrievalCapabilities.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RetrievalCapabilities.baboonMinReaderVersions
  }
  
  object RetrievalCapabilities {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#RetrievalCapabilities"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RetrievalCapabilities] = RetrievalCapabilities_JsonCodec.instance
  }
  
  object RetrievalCapabilities_JsonCodec extends BaboonJsonCodec.BaseGenerated[RetrievalCapabilities, BaboonJsonCodec[RetrievalCapabilities]] {
    def encode(ctx: BaboonCodecContext, value: RetrievalCapabilities): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "modes" -> Json.fromValues(value.modes.map(e => RetrievalMode_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RetrievalCapabilities] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            modes <- getField(jsonObject, "modes").flatMap(v => decodeList(RetrievalMode_JsonCodec.circeDecoder)(v.hcursor))
          } yield RetrievalCapabilities(modes)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RetrievalCapabilities: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RetrievalCapabilities.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RetrievalCapabilities.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RetrievalCapabilities.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RetrievalCapabilities]] = Lazy(RetrievalCapabilities_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RetrievalCapabilities]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RetrievalCapabilities] = LazyInstance.value
  }
}