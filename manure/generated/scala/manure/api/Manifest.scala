import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class Manifest(
    artifactId: String,
    state: ArtifactState,
    files: List[ManifestEntry]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Manifest.baboonDomainVersion
    override def baboonDomainIdentifier: String = Manifest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Manifest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Manifest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Manifest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Manifest.baboonMinReaderVersions
  }
  
  object Manifest {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#Manifest"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Manifest] = Manifest_JsonCodec.instance
  }
  
  object Manifest_JsonCodec extends BaboonJsonCodec.BaseGenerated[Manifest, BaboonJsonCodec[Manifest]] {
    def encode(ctx: BaboonCodecContext, value: Manifest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "artifactId" -> Json.fromString(value.artifactId),
        "state" -> ArtifactState_JsonCodec.instance.encode(ctx, value.state),
        "files" -> Json.fromValues(value.files.map(e => ManifestEntry_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Manifest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            artifactId <- getField(jsonObject, "artifactId").flatMap(v => decodeString(v.hcursor))
            state <- getField(jsonObject, "state").flatMap(v => ArtifactState_JsonCodec.circeDecoder(v.hcursor))
            files <- getField(jsonObject, "files").flatMap(v => decodeList(ManifestEntry_JsonCodec.circeDecoder)(v.hcursor))
          } yield Manifest(artifactId,state,files)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Manifest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Manifest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Manifest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Manifest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Manifest]] = Lazy(Manifest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Manifest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Manifest] = LazyInstance.value
  }
}