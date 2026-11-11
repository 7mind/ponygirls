import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ProjectionTarget(
    scope: String,
    generation: Long,
    digest: String,
    origin: ProjectionTargetOrigin
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ProjectionTarget.baboonDomainVersion
    override def baboonDomainIdentifier: String = ProjectionTarget.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ProjectionTarget.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ProjectionTarget.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ProjectionTarget.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ProjectionTarget.baboonMinReaderVersions
  }
  
  object ProjectionTarget {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ProjectionTarget"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ProjectionTarget] = ProjectionTarget_JsonCodec.instance
  }
  
  object ProjectionTarget_JsonCodec extends BaboonJsonCodec.BaseGenerated[ProjectionTarget, BaboonJsonCodec[ProjectionTarget]] {
    def encode(ctx: BaboonCodecContext, value: ProjectionTarget): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "generation" -> Json.fromString(value.generation.toString),
        "digest" -> Json.fromString(value.digest),
        "origin" -> ProjectionTargetOrigin_JsonCodec.instance.encode(ctx, value.origin)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ProjectionTarget] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            digest <- getField(jsonObject, "digest").flatMap(v => decodeString(v.hcursor))
            origin <- getField(jsonObject, "origin").flatMap(v => ProjectionTargetOrigin_JsonCodec.circeDecoder(v.hcursor))
          } yield ProjectionTarget(scope,generation,digest,origin)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ProjectionTarget: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ProjectionTarget.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ProjectionTarget.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ProjectionTarget.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ProjectionTarget]] = Lazy(ProjectionTarget_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ProjectionTarget]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ProjectionTarget] = LazyInstance.value
  }
}