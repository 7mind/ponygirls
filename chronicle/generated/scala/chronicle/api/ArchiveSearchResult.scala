import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ArchiveSearchResult(
    page: ArchiveResult,
    evidence: List[ArchiveSearchEvidence]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ArchiveSearchResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ArchiveSearchResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ArchiveSearchResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ArchiveSearchResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ArchiveSearchResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ArchiveSearchResult.baboonMinReaderVersions
  }
  
  object ArchiveSearchResult {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ArchiveSearchResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ArchiveSearchResult] = ArchiveSearchResult_JsonCodec.instance
  }
  
  object ArchiveSearchResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ArchiveSearchResult, BaboonJsonCodec[ArchiveSearchResult]] {
    def encode(ctx: BaboonCodecContext, value: ArchiveSearchResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "page" -> ArchiveResult_JsonCodec.instance.encode(ctx, value.page),
        "evidence" -> Json.fromValues(value.evidence.map(e => ArchiveSearchEvidence_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ArchiveSearchResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            page <- getField(jsonObject, "page").flatMap(v => ArchiveResult_JsonCodec.circeDecoder(v.hcursor))
            evidence <- getField(jsonObject, "evidence").flatMap(v => decodeList(ArchiveSearchEvidence_JsonCodec.circeDecoder)(v.hcursor))
          } yield ArchiveSearchResult(page,evidence)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ArchiveSearchResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ArchiveSearchResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ArchiveSearchResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ArchiveSearchResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ArchiveSearchResult]] = Lazy(ArchiveSearchResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ArchiveSearchResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ArchiveSearchResult] = LazyInstance.value
  }
}