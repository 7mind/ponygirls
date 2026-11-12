import io.circe.Decoder.decodeUUID
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class ProjectionAckInput(
    sessionId: UUID,
    requestId: UUID,
    target: ProjectionTarget,
    observed: ProjectionCheckpoint
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ProjectionAckInput.baboonDomainVersion
    override def baboonDomainIdentifier: String = ProjectionAckInput.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ProjectionAckInput.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ProjectionAckInput.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ProjectionAckInput.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ProjectionAckInput.baboonMinReaderVersions
  }
  
  object ProjectionAckInput {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ProjectionAckInput"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ProjectionAckInput] = ProjectionAckInput_JsonCodec.instance
  }
  
  object ProjectionAckInput_JsonCodec extends BaboonJsonCodec.BaseGenerated[ProjectionAckInput, BaboonJsonCodec[ProjectionAckInput]] {
    def encode(ctx: BaboonCodecContext, value: ProjectionAckInput): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "sessionId" -> Json.fromString(value.sessionId.toString()),
        "requestId" -> Json.fromString(value.requestId.toString()),
        "target" -> ProjectionTarget_JsonCodec.instance.encode(ctx, value.target),
        "observed" -> ProjectionCheckpoint_JsonCodec.instance.encode(ctx, value.observed)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ProjectionAckInput] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            sessionId <- getField(jsonObject, "sessionId").flatMap(v => decodeUUID(v.hcursor))
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            target <- getField(jsonObject, "target").flatMap(v => ProjectionTarget_JsonCodec.circeDecoder(v.hcursor))
            observed <- getField(jsonObject, "observed").flatMap(v => ProjectionCheckpoint_JsonCodec.circeDecoder(v.hcursor))
          } yield ProjectionAckInput(sessionId,requestId,target,observed)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ProjectionAckInput: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ProjectionAckInput.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ProjectionAckInput.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ProjectionAckInput.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ProjectionAckInput]] = Lazy(ProjectionAckInput_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ProjectionAckInput]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ProjectionAckInput] = LazyInstance.value
  }
}