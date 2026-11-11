import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class Artifact(
    artifactId: String,
    name: String,
    kind: ArtifactKind,
    visibility: Visibility,
    state: ArtifactState,
    createdByUser: String,
    createdAt: String,
    expiresAt: Option[String],
    totalBytes: Long,
    fileCount: Int,
    contentUrl: String,
    tags: List[String],
    hostname: Option[String],
    projectPath: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Artifact.baboonDomainVersion
    override def baboonDomainIdentifier: String = Artifact.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Artifact.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Artifact.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Artifact.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Artifact.baboonMinReaderVersions
  }
  
  object Artifact {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#Artifact"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Artifact] = Artifact_JsonCodec.instance
  }
  
  object Artifact_JsonCodec extends BaboonJsonCodec.BaseGenerated[Artifact, BaboonJsonCodec[Artifact]] {
    def encode(ctx: BaboonCodecContext, value: Artifact): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "artifactId" -> Json.fromString(value.artifactId),
        "name" -> Json.fromString(value.name),
        "kind" -> ArtifactKind_JsonCodec.instance.encode(ctx, value.kind),
        "visibility" -> Visibility_JsonCodec.instance.encode(ctx, value.visibility),
        "state" -> ArtifactState_JsonCodec.instance.encode(ctx, value.state),
        "createdByUser" -> Json.fromString(value.createdByUser),
        "createdAt" -> Json.fromString(value.createdAt),
        "expiresAt" -> value.expiresAt.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "totalBytes" -> Json.fromString(value.totalBytes.toString),
        "fileCount" -> Json.fromInt(value.fileCount),
        "contentUrl" -> Json.fromString(value.contentUrl),
        "tags" -> Json.fromValues(value.tags.map(e => Json.fromString(e))),
        "hostname" -> value.hostname.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "projectPath" -> value.projectPath.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Artifact] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            artifactId <- getField(jsonObject, "artifactId").flatMap(v => decodeString(v.hcursor))
            name <- getField(jsonObject, "name").flatMap(v => decodeString(v.hcursor))
            kind <- getField(jsonObject, "kind").flatMap(v => ArtifactKind_JsonCodec.circeDecoder(v.hcursor))
            visibility <- getField(jsonObject, "visibility").flatMap(v => Visibility_JsonCodec.circeDecoder(v.hcursor))
            state <- getField(jsonObject, "state").flatMap(v => ArtifactState_JsonCodec.circeDecoder(v.hcursor))
            createdByUser <- getField(jsonObject, "createdByUser").flatMap(v => decodeString(v.hcursor))
            createdAt <- getField(jsonObject, "createdAt").flatMap(v => decodeString(v.hcursor))
            expiresAt <- getField(jsonObject, "expiresAt").flatMap(v => decodeOption(decodeString)(v.hcursor))
            totalBytes <- getField(jsonObject, "totalBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            fileCount <- getField(jsonObject, "fileCount").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            contentUrl <- getField(jsonObject, "contentUrl").flatMap(v => decodeString(v.hcursor))
            tags <- getField(jsonObject, "tags").flatMap(v => decodeList(decodeString)(v.hcursor))
            hostname <- getField(jsonObject, "hostname").flatMap(v => decodeOption(decodeString)(v.hcursor))
            projectPath <- getField(jsonObject, "projectPath").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield Artifact(artifactId,name,kind,visibility,state,createdByUser,createdAt,expiresAt,totalBytes,fileCount,contentUrl,tags,hostname,projectPath)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Artifact: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Artifact.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Artifact.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Artifact.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Artifact]] = Lazy(Artifact_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Artifact]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Artifact] = LazyInstance.value
  }
}