import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class HistoryResult(
    revisions: List[RevisionInfo]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = HistoryResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = HistoryResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = HistoryResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = HistoryResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = HistoryResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = HistoryResult.baboonMinReaderVersions
  }
  
  object HistoryResult {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#HistoryResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[HistoryResult] = HistoryResult_JsonCodec.instance
  }
  
  object HistoryResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[HistoryResult, BaboonJsonCodec[HistoryResult]] {
    def encode(ctx: BaboonCodecContext, value: HistoryResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "revisions" -> Json.fromValues(value.revisions.map(e => RevisionInfo_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, HistoryResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            revisions <- getField(jsonObject, "revisions").flatMap(v => decodeList(RevisionInfo_JsonCodec.circeDecoder)(v.hcursor))
          } yield HistoryResult(revisions)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to HistoryResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = HistoryResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = HistoryResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = HistoryResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[HistoryResult]] = Lazy(HistoryResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[HistoryResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[HistoryResult] = LazyInstance.value
  }
}