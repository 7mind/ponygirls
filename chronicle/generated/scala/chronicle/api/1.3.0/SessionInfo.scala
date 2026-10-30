import io.circe.Decoder.{decodeBoolean, decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}
import java.util.UUID

package chronicle.api.v1_3_0 {
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
  final case class SessionInfo(
    view: ContentView,
    id: UUID,
    ownerId: String,
    revision: Int,
    indexedRevision: Option[Int],
    metadata: Metadata,
    source: SourceIdentity,
    completion: Completion,
    redacted: Boolean
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = SessionInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = SessionInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SessionInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SessionInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SessionInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SessionInfo.baboonMinReaderVersions
  }
  
  object SessionInfo {
    def baboonDomainVersion: String = "1.3.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#SessionInfo"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[SessionInfo] = SessionInfo_JsonCodec.instance
  }
  
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.8.0")
  object SessionInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[SessionInfo, BaboonJsonCodec[SessionInfo]] {
    def encode(ctx: BaboonCodecContext, value: SessionInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "view" -> ContentView_JsonCodec.instance.encode(ctx, value.view),
        "id" -> Json.fromString(value.id.toString()),
        "ownerId" -> Json.fromString(value.ownerId),
        "revision" -> Json.fromInt(value.revision),
        "indexedRevision" -> value.indexedRevision.map(v => Json.fromInt(v)).getOrElse(Json.Null),
        "metadata" -> Metadata_JsonCodec.instance.encode(ctx, value.metadata),
        "source" -> SourceIdentity_JsonCodec.instance.encode(ctx, value.source),
        "completion" -> Completion_JsonCodec.instance.encode(ctx, value.completion),
        "redacted" -> Json.fromBoolean(value.redacted)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SessionInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            view <- getField(jsonObject, "view").flatMap(v => ContentView_JsonCodec.circeDecoder(v.hcursor))
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            ownerId <- getField(jsonObject, "ownerId").flatMap(v => decodeString(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            indexedRevision <- getField(jsonObject, "indexedRevision").flatMap(v => decodeOption(BaboonJsonCodec.decodeInt)(v.hcursor))
            metadata <- getField(jsonObject, "metadata").flatMap(v => Metadata_JsonCodec.circeDecoder(v.hcursor))
            source <- getField(jsonObject, "source").flatMap(v => SourceIdentity_JsonCodec.circeDecoder(v.hcursor))
            completion <- getField(jsonObject, "completion").flatMap(v => Completion_JsonCodec.circeDecoder(v.hcursor))
            redacted <- getField(jsonObject, "redacted").flatMap(v => decodeBoolean(v.hcursor))
          } yield SessionInfo(view,id,ownerId,revision,indexedRevision,metadata,source,completion,redacted)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SessionInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SessionInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SessionInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SessionInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SessionInfo]] = Lazy(SessionInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SessionInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SessionInfo] = LazyInstance.value
  }
}