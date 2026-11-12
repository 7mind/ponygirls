import io.circe.Decoder.decodeOption
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ProjectionProgress(
    issuedThrough: Int,
    batch: Option[ProjectionIssuedBatch]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ProjectionProgress.baboonDomainVersion
    override def baboonDomainIdentifier: String = ProjectionProgress.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ProjectionProgress.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ProjectionProgress.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ProjectionProgress.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ProjectionProgress.baboonMinReaderVersions
  }
  
  object ProjectionProgress {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ProjectionProgress"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ProjectionProgress] = ProjectionProgress_JsonCodec.instance
  }
  
  object ProjectionProgress_JsonCodec extends BaboonJsonCodec.BaseGenerated[ProjectionProgress, BaboonJsonCodec[ProjectionProgress]] {
    def encode(ctx: BaboonCodecContext, value: ProjectionProgress): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "issuedThrough" -> Json.fromInt(value.issuedThrough),
        "batch" -> value.batch.map(v => ProjectionIssuedBatch_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ProjectionProgress] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            issuedThrough <- getField(jsonObject, "issuedThrough").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            batch <- getField(jsonObject, "batch").flatMap(v => decodeOption(ProjectionIssuedBatch_JsonCodec.circeDecoder)(v.hcursor))
          } yield ProjectionProgress(issuedThrough,batch)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ProjectionProgress: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ProjectionProgress.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ProjectionProgress.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ProjectionProgress.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ProjectionProgress]] = Lazy(ProjectionProgress_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ProjectionProgress]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ProjectionProgress] = LazyInstance.value
  }
}