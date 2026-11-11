import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ProjectionCheckpoint(
    instance: ProjectionInstance,
    scope: String,
    generation: Long,
    digest: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ProjectionCheckpoint.baboonDomainVersion
    override def baboonDomainIdentifier: String = ProjectionCheckpoint.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ProjectionCheckpoint.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ProjectionCheckpoint.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ProjectionCheckpoint.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ProjectionCheckpoint.baboonMinReaderVersions
  }
  
  object ProjectionCheckpoint {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ProjectionCheckpoint"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ProjectionCheckpoint] = ProjectionCheckpoint_JsonCodec.instance
  }
  
  object ProjectionCheckpoint_JsonCodec extends BaboonJsonCodec.BaseGenerated[ProjectionCheckpoint, BaboonJsonCodec[ProjectionCheckpoint]] {
    def encode(ctx: BaboonCodecContext, value: ProjectionCheckpoint): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "instance" -> ProjectionInstance_JsonCodec.instance.encode(ctx, value.instance),
        "scope" -> Json.fromString(value.scope),
        "generation" -> Json.fromString(value.generation.toString),
        "digest" -> Json.fromString(value.digest)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ProjectionCheckpoint] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            instance <- getField(jsonObject, "instance").flatMap(v => ProjectionInstance_JsonCodec.circeDecoder(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            digest <- getField(jsonObject, "digest").flatMap(v => decodeString(v.hcursor))
          } yield ProjectionCheckpoint(instance,scope,generation,digest)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ProjectionCheckpoint: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ProjectionCheckpoint.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ProjectionCheckpoint.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ProjectionCheckpoint.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ProjectionCheckpoint]] = Lazy(ProjectionCheckpoint_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ProjectionCheckpoint]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ProjectionCheckpoint] = LazyInstance.value
  }
}