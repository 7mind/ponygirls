import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_6_0 {
  @deprecated("Version 1.6.0 is deprecated, you should migrate to 1.8.0")
  final case class Metadata(
    title: String,
    project: Option[String],
    workdir: Option[String],
    gitRemote: Option[String],
    gitBranch: Option[String],
    gitCommit: Option[String],
    producer: String,
    model: Option[String],
    startedAt: Option[String],
    endedAt: Option[String],
    tags: List[String]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = Metadata.baboonDomainVersion
    override def baboonDomainIdentifier: String = Metadata.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Metadata.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Metadata.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Metadata.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Metadata.baboonMinReaderVersions
  }
  
  object Metadata {
    def baboonDomainVersion: String = "1.6.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#Metadata"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Metadata] = Metadata_JsonCodec.instance
  }
  
  @deprecated("Version 1.6.0 is deprecated, you should migrate to 1.8.0")
  object Metadata_JsonCodec extends BaboonJsonCodec.BaseGenerated[Metadata, BaboonJsonCodec[Metadata]] {
    def encode(ctx: BaboonCodecContext, value: Metadata): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "title" -> Json.fromString(value.title),
        "project" -> value.project.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "workdir" -> value.workdir.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "gitRemote" -> value.gitRemote.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "gitBranch" -> value.gitBranch.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "gitCommit" -> value.gitCommit.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "producer" -> Json.fromString(value.producer),
        "model" -> value.model.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "startedAt" -> value.startedAt.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "endedAt" -> value.endedAt.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "tags" -> Json.fromValues(value.tags.map(e => Json.fromString(e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Metadata] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            title <- getField(jsonObject, "title").flatMap(v => decodeString(v.hcursor))
            project <- getField(jsonObject, "project").flatMap(v => decodeOption(decodeString)(v.hcursor))
            workdir <- getField(jsonObject, "workdir").flatMap(v => decodeOption(decodeString)(v.hcursor))
            gitRemote <- getField(jsonObject, "gitRemote").flatMap(v => decodeOption(decodeString)(v.hcursor))
            gitBranch <- getField(jsonObject, "gitBranch").flatMap(v => decodeOption(decodeString)(v.hcursor))
            gitCommit <- getField(jsonObject, "gitCommit").flatMap(v => decodeOption(decodeString)(v.hcursor))
            producer <- getField(jsonObject, "producer").flatMap(v => decodeString(v.hcursor))
            model <- getField(jsonObject, "model").flatMap(v => decodeOption(decodeString)(v.hcursor))
            startedAt <- getField(jsonObject, "startedAt").flatMap(v => decodeOption(decodeString)(v.hcursor))
            endedAt <- getField(jsonObject, "endedAt").flatMap(v => decodeOption(decodeString)(v.hcursor))
            tags <- getField(jsonObject, "tags").flatMap(v => decodeList(decodeString)(v.hcursor))
          } yield Metadata(title,project,workdir,gitRemote,gitBranch,gitCommit,producer,model,startedAt,endedAt,tags)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Metadata: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Metadata.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Metadata.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Metadata.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Metadata]] = Lazy(Metadata_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Metadata]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Metadata] = LazyInstance.value
  }
}