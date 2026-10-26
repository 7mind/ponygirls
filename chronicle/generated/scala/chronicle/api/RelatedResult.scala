import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class RelatedResult(
    sessions: List[SearchHit]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RelatedResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = RelatedResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RelatedResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RelatedResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RelatedResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RelatedResult.baboonMinReaderVersions
  }
  
  object RelatedResult {
    def baboonDomainVersion: String = "1.4.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#RelatedResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RelatedResult] = RelatedResult_JsonCodec.instance
  }
  
  object RelatedResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[RelatedResult, BaboonJsonCodec[RelatedResult]] {
    def encode(ctx: BaboonCodecContext, value: RelatedResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "sessions" -> Json.fromValues(value.sessions.map(e => SearchHit_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelatedResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            sessions <- getField(jsonObject, "sessions").flatMap(v => decodeList(SearchHit_JsonCodec.circeDecoder)(v.hcursor))
          } yield RelatedResult(sessions)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RelatedResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RelatedResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RelatedResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RelatedResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelatedResult]] = Lazy(RelatedResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RelatedResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RelatedResult] = LazyInstance.value
  }
}