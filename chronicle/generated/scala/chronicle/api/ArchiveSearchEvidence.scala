import io.circe.Decoder.{decodeList, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package chronicle.api {
  final case class ArchiveSearchEvidence(
    sessionId: UUID,
    matches: List[ArchiveSourceMatch]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ArchiveSearchEvidence.baboonDomainVersion
    override def baboonDomainIdentifier: String = ArchiveSearchEvidence.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ArchiveSearchEvidence.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ArchiveSearchEvidence.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ArchiveSearchEvidence.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ArchiveSearchEvidence.baboonMinReaderVersions
  }
  
  object ArchiveSearchEvidence {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ArchiveSearchEvidence"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ArchiveSearchEvidence] = ArchiveSearchEvidence_JsonCodec.instance
  }
  
  object ArchiveSearchEvidence_JsonCodec extends BaboonJsonCodec.BaseGenerated[ArchiveSearchEvidence, BaboonJsonCodec[ArchiveSearchEvidence]] {
    def encode(ctx: BaboonCodecContext, value: ArchiveSearchEvidence): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "sessionId" -> Json.fromString(value.sessionId.toString()),
        "matches" -> Json.fromValues(value.matches.map(e => ArchiveSourceMatch_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ArchiveSearchEvidence] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeUUID(v.hcursor))
            matches <- getField(jsonObject, "matches").flatMap(v => decodeList(ArchiveSourceMatch_JsonCodec.circeDecoder)(v.hcursor))
          } yield ArchiveSearchEvidence(sessionId,matches)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ArchiveSearchEvidence: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ArchiveSearchEvidence.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ArchiveSearchEvidence.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ArchiveSearchEvidence.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ArchiveSearchEvidence]] = Lazy(ArchiveSearchEvidence_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ArchiveSearchEvidence]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ArchiveSearchEvidence] = LazyInstance.value
  }
}