import io.circe.Decoder.decodeBoolean
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class IngestResult(
    source: Ref,
    frontier: Long,
    replayed: Boolean
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = IngestResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = IngestResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = IngestResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = IngestResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = IngestResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = IngestResult.baboonMinReaderVersions
  }
  
  object IngestResult {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#IngestResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[IngestResult] = IngestResult_JsonCodec.instance
  }
  
  object IngestResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[IngestResult, BaboonJsonCodec[IngestResult]] {
    def encode(ctx: BaboonCodecContext, value: IngestResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "source" -> Ref_JsonCodec.instance.encode(ctx, value.source),
        "frontier" -> Json.fromString(value.frontier.toString),
        "replayed" -> Json.fromBoolean(value.replayed)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, IngestResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            source <- getField(jsonObject, "source").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            replayed <- getField(jsonObject, "replayed").flatMap(v => decodeBoolean(v.hcursor))
          } yield IngestResult(source,frontier,replayed)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to IngestResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = IngestResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = IngestResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = IngestResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[IngestResult]] = Lazy(IngestResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[IngestResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[IngestResult] = LazyInstance.value
  }
}