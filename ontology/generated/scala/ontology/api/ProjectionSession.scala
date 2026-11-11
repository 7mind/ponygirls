import io.circe.Decoder.{decodeList, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class ProjectionSession(
    id: UUID,
    fence: CoordinatorFence,
    instance: ProjectionInstance,
    actor: Actor,
    scopes: List[String],
    batchLimit: Int,
    openedAt: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ProjectionSession.baboonDomainVersion
    override def baboonDomainIdentifier: String = ProjectionSession.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ProjectionSession.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ProjectionSession.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ProjectionSession.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ProjectionSession.baboonMinReaderVersions
  }
  
  object ProjectionSession {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ProjectionSession"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ProjectionSession] = ProjectionSession_JsonCodec.instance
  }
  
  object ProjectionSession_JsonCodec extends BaboonJsonCodec.BaseGenerated[ProjectionSession, BaboonJsonCodec[ProjectionSession]] {
    def encode(ctx: BaboonCodecContext, value: ProjectionSession): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "fence" -> CoordinatorFence_JsonCodec.instance.encode(ctx, value.fence),
        "instance" -> ProjectionInstance_JsonCodec.instance.encode(ctx, value.instance),
        "actor" -> Actor_JsonCodec.instance.encode(ctx, value.actor),
        "scopes" -> Json.fromValues(value.scopes.map(e => Json.fromString(e))),
        "batchLimit" -> Json.fromInt(value.batchLimit),
        "openedAt" -> Json.fromString(value.openedAt)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ProjectionSession] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            fence <- getField(jsonObject, "fence").flatMap(v => CoordinatorFence_JsonCodec.circeDecoder(v.hcursor))
            instance <- getField(jsonObject, "instance").flatMap(v => ProjectionInstance_JsonCodec.circeDecoder(v.hcursor))
            actor <- getField(jsonObject, "actor").flatMap(v => Actor_JsonCodec.circeDecoder(v.hcursor))
            scopes <- getField(jsonObject, "scopes").flatMap(v => decodeList(decodeString)(v.hcursor))
            batchLimit <- getField(jsonObject, "batchLimit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            openedAt <- getField(jsonObject, "openedAt").flatMap(v => decodeString(v.hcursor))
          } yield ProjectionSession(id,fence,instance,actor,scopes,batchLimit,openedAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ProjectionSession: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ProjectionSession.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ProjectionSession.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ProjectionSession.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ProjectionSession]] = Lazy(ProjectionSession_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ProjectionSession]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ProjectionSession] = LazyInstance.value
  }
}