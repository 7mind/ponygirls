import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ProjectionStoreIdentity(
    format: Int,
    instance: ProjectionInstance
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ProjectionStoreIdentity.baboonDomainVersion
    override def baboonDomainIdentifier: String = ProjectionStoreIdentity.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ProjectionStoreIdentity.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ProjectionStoreIdentity.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ProjectionStoreIdentity.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ProjectionStoreIdentity.baboonMinReaderVersions
  }
  
  object ProjectionStoreIdentity {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ProjectionStoreIdentity"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ProjectionStoreIdentity] = ProjectionStoreIdentity_JsonCodec.instance
  }
  
  object ProjectionStoreIdentity_JsonCodec extends BaboonJsonCodec.BaseGenerated[ProjectionStoreIdentity, BaboonJsonCodec[ProjectionStoreIdentity]] {
    def encode(ctx: BaboonCodecContext, value: ProjectionStoreIdentity): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "format" -> Json.fromInt(value.format),
        "instance" -> ProjectionInstance_JsonCodec.instance.encode(ctx, value.instance)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ProjectionStoreIdentity] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            format <- getField(jsonObject, "format").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            instance <- getField(jsonObject, "instance").flatMap(v => ProjectionInstance_JsonCodec.circeDecoder(v.hcursor))
          } yield ProjectionStoreIdentity(format,instance)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ProjectionStoreIdentity: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ProjectionStoreIdentity.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ProjectionStoreIdentity.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ProjectionStoreIdentity.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ProjectionStoreIdentity]] = Lazy(ProjectionStoreIdentity_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ProjectionStoreIdentity]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ProjectionStoreIdentity] = LazyInstance.value
  }
}