import io.circe.Decoder.{decodeList, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package chronicle.api {
  final case class RawManifest(
    sessionId: UUID,
    revision: Int,
    files: List[RawFileInfo]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RawManifest.baboonDomainVersion
    override def baboonDomainIdentifier: String = RawManifest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RawManifest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RawManifest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RawManifest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RawManifest.baboonMinReaderVersions
  }
  
  object RawManifest {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#RawManifest"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RawManifest] = RawManifest_JsonCodec.instance
  }
  
  object RawManifest_JsonCodec extends BaboonJsonCodec.BaseGenerated[RawManifest, BaboonJsonCodec[RawManifest]] {
    def encode(ctx: BaboonCodecContext, value: RawManifest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "sessionId" -> Json.fromString(value.sessionId.toString()),
        "revision" -> Json.fromInt(value.revision),
        "files" -> Json.fromValues(value.files.map(e => RawFileInfo_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RawManifest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeUUID(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            files <- getField(jsonObject, "files").flatMap(v => decodeList(RawFileInfo_JsonCodec.circeDecoder)(v.hcursor))
          } yield RawManifest(sessionId,revision,files)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RawManifest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RawManifest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RawManifest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RawManifest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RawManifest]] = Lazy(RawManifest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RawManifest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RawManifest] = LazyInstance.value
  }
}