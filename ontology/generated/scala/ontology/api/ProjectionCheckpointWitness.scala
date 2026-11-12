import io.circe.Decoder.decodeUUID
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class ProjectionCheckpointWitness(
    checkpoint: ProjectionCheckpoint,
    sessionId: UUID,
    requestId: UUID
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ProjectionCheckpointWitness.baboonDomainVersion
    override def baboonDomainIdentifier: String = ProjectionCheckpointWitness.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ProjectionCheckpointWitness.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ProjectionCheckpointWitness.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ProjectionCheckpointWitness.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ProjectionCheckpointWitness.baboonMinReaderVersions
  }
  
  object ProjectionCheckpointWitness {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ProjectionCheckpointWitness"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ProjectionCheckpointWitness] = ProjectionCheckpointWitness_JsonCodec.instance
  }
  
  object ProjectionCheckpointWitness_JsonCodec extends BaboonJsonCodec.BaseGenerated[ProjectionCheckpointWitness, BaboonJsonCodec[ProjectionCheckpointWitness]] {
    def encode(ctx: BaboonCodecContext, value: ProjectionCheckpointWitness): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "checkpoint" -> ProjectionCheckpoint_JsonCodec.instance.encode(ctx, value.checkpoint),
        "sessionId" -> Json.fromString(value.sessionId.toString()),
        "requestId" -> Json.fromString(value.requestId.toString())
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ProjectionCheckpointWitness] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            checkpoint <- getField(jsonObject, "checkpoint").flatMap(v => ProjectionCheckpoint_JsonCodec.circeDecoder(v.hcursor))
            sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeUUID(v.hcursor))
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
          } yield ProjectionCheckpointWitness(checkpoint,sessionId,requestId)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ProjectionCheckpointWitness: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ProjectionCheckpointWitness.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ProjectionCheckpointWitness.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ProjectionCheckpointWitness.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ProjectionCheckpointWitness]] = Lazy(ProjectionCheckpointWitness_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ProjectionCheckpointWitness]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ProjectionCheckpointWitness] = LazyInstance.value
  }
}