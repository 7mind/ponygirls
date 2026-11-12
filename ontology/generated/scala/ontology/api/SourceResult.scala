import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class SourceResult(
    scope: String,
    events: List[CapturedEvent],
    frontier: Long,
    nextAfter: Option[Long]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SourceResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = SourceResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SourceResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SourceResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SourceResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SourceResult.baboonMinReaderVersions
  }
  
  object SourceResult {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#SourceResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SourceResult] = SourceResult_JsonCodec.instance
  }
  
  object SourceResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[SourceResult, BaboonJsonCodec[SourceResult]] {
    def encode(ctx: BaboonCodecContext, value: SourceResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "events" -> Json.fromValues(value.events.map(e => CapturedEvent_JsonCodec.instance.encode(ctx, e))),
        "frontier" -> Json.fromString(value.frontier.toString),
        "nextAfter" -> value.nextAfter.map(v => Json.fromString(v.toString)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SourceResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            events <- getField(jsonObject, "events").flatMap(v => decodeList(CapturedEvent_JsonCodec.circeDecoder)(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            nextAfter <- getField(jsonObject, "nextAfter").flatMap(v => decodeOption(BaboonJsonCodec.decodeLong)(v.hcursor))
          } yield SourceResult(scope,events,frontier,nextAfter)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SourceResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SourceResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SourceResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SourceResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SourceResult]] = Lazy(SourceResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SourceResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SourceResult] = LazyInstance.value
  }
}