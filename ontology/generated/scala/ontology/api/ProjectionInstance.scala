import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class ProjectionInstance(
    targetId: String,
    incarnation: UUID
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ProjectionInstance.baboonDomainVersion
    override def baboonDomainIdentifier: String = ProjectionInstance.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ProjectionInstance.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ProjectionInstance.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ProjectionInstance.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ProjectionInstance.baboonMinReaderVersions
  }
  
  object ProjectionInstance {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ProjectionInstance"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ProjectionInstance] = ProjectionInstance_JsonCodec.instance
  }
  
  object ProjectionInstance_JsonCodec extends BaboonJsonCodec.BaseGenerated[ProjectionInstance, BaboonJsonCodec[ProjectionInstance]] {
    def encode(ctx: BaboonCodecContext, value: ProjectionInstance): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "targetId" -> Json.fromString(value.targetId),
        "incarnation" -> Json.fromString(value.incarnation.toString())
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ProjectionInstance] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            targetId <- getField(jsonObject, "targetId").flatMap(v => decodeString(v.hcursor))
            incarnation <- getField(jsonObject, "incarnation").flatMap(v => decodeUUID(v.hcursor))
          } yield ProjectionInstance(targetId,incarnation)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ProjectionInstance: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ProjectionInstance.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ProjectionInstance.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ProjectionInstance.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ProjectionInstance]] = Lazy(ProjectionInstance_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ProjectionInstance]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ProjectionInstance] = LazyInstance.value
  }
}