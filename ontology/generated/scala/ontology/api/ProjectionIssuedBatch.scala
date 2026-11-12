import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ProjectionIssuedBatch(
    startIndex: Int,
    targets: List[ProjectionTarget]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ProjectionIssuedBatch.baboonDomainVersion
    override def baboonDomainIdentifier: String = ProjectionIssuedBatch.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ProjectionIssuedBatch.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ProjectionIssuedBatch.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ProjectionIssuedBatch.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ProjectionIssuedBatch.baboonMinReaderVersions
  }
  
  object ProjectionIssuedBatch {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ProjectionIssuedBatch"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ProjectionIssuedBatch] = ProjectionIssuedBatch_JsonCodec.instance
  }
  
  object ProjectionIssuedBatch_JsonCodec extends BaboonJsonCodec.BaseGenerated[ProjectionIssuedBatch, BaboonJsonCodec[ProjectionIssuedBatch]] {
    def encode(ctx: BaboonCodecContext, value: ProjectionIssuedBatch): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "startIndex" -> Json.fromInt(value.startIndex),
        "targets" -> Json.fromValues(value.targets.map(e => ProjectionTarget_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ProjectionIssuedBatch] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            startIndex <- getField(jsonObject, "startIndex").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            targets <- getField(jsonObject, "targets").flatMap(v => decodeList(ProjectionTarget_JsonCodec.circeDecoder)(v.hcursor))
          } yield ProjectionIssuedBatch(startIndex,targets)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ProjectionIssuedBatch: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ProjectionIssuedBatch.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ProjectionIssuedBatch.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ProjectionIssuedBatch.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ProjectionIssuedBatch]] = Lazy(ProjectionIssuedBatch_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ProjectionIssuedBatch]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ProjectionIssuedBatch] = LazyInstance.value
  }
}