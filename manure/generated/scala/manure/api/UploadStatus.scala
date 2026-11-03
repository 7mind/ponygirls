import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class UploadStatus(
    artifactId: String,
    state: ArtifactState,
    chunkBytes: Int,
    files: List[FileProgress]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = UploadStatus.baboonDomainVersion
    override def baboonDomainIdentifier: String = UploadStatus.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = UploadStatus.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = UploadStatus.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = UploadStatus.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = UploadStatus.baboonMinReaderVersions
  }
  
  object UploadStatus {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#UploadStatus"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[UploadStatus] = UploadStatus_JsonCodec.instance
  }
  
  object UploadStatus_JsonCodec extends BaboonJsonCodec.BaseGenerated[UploadStatus, BaboonJsonCodec[UploadStatus]] {
    def encode(ctx: BaboonCodecContext, value: UploadStatus): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "artifactId" -> Json.fromString(value.artifactId),
        "state" -> ArtifactState_JsonCodec.instance.encode(ctx, value.state),
        "chunkBytes" -> Json.fromInt(value.chunkBytes),
        "files" -> Json.fromValues(value.files.map(e => FileProgress_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, UploadStatus] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            artifactId <- getField(jsonObject, "artifactId").flatMap(v => decodeString(v.hcursor))
            state <- getField(jsonObject, "state").flatMap(v => ArtifactState_JsonCodec.circeDecoder(v.hcursor))
            chunkBytes <- getField(jsonObject, "chunkBytes").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            files <- getField(jsonObject, "files").flatMap(v => decodeList(FileProgress_JsonCodec.circeDecoder)(v.hcursor))
          } yield UploadStatus(artifactId,state,chunkBytes,files)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to UploadStatus: object expected"))
      }
    }
  
    def baboonDomainVersion: String = UploadStatus.baboonDomainVersion
    
    def baboonDomainIdentifier: String = UploadStatus.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = UploadStatus.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[UploadStatus]] = Lazy(UploadStatus_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[UploadStatus]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[UploadStatus] = LazyInstance.value
  }
}