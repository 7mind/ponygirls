import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_5_0 {
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.7.0")
  final case class ArchiveRow(
    head: SessionInfo,
    publishedView: Option[ContentView],
    matchedView: Option[ContentView],
    lastTimestamp: Option[String],
    messageCount: Int,
    tags: List[String],
    headJob: Option[JobInfo],
    publishedFormat: Option[PassageFormat]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = ArchiveRow.baboonDomainVersion
    override def baboonDomainIdentifier: String = ArchiveRow.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ArchiveRow.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ArchiveRow.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ArchiveRow.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ArchiveRow.baboonMinReaderVersions
  }
  
  object ArchiveRow {
    def baboonDomainVersion: String = "1.5.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ArchiveRow"
    private lazy val _baboonSameInVersions: List[String] = List("1.5.0", "1.6.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.5.0" -> "identical", "1.6.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.3.0", "prefix-compact" -> "1.3.0", "prefix-any-mode" -> "1.5.0", "identical" -> "1.5.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[ArchiveRow] = ArchiveRow_JsonCodec.instance
  }
  
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.7.0")
  object ArchiveRow_JsonCodec extends BaboonJsonCodec.BaseGenerated[ArchiveRow, BaboonJsonCodec[ArchiveRow]] {
    def encode(ctx: BaboonCodecContext, value: ArchiveRow): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "head" -> SessionInfo_JsonCodec.instance.encode(ctx, value.head),
        "publishedView" -> value.publishedView.map(v => ContentView_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "matchedView" -> value.matchedView.map(v => ContentView_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "lastTimestamp" -> value.lastTimestamp.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "messageCount" -> Json.fromInt(value.messageCount),
        "tags" -> Json.fromValues(value.tags.map(e => Json.fromString(e))),
        "headJob" -> value.headJob.map(v => JobInfo_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "publishedFormat" -> value.publishedFormat.map(v => PassageFormat_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ArchiveRow] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            head <- getField(jsonObject, "head").flatMap(v => SessionInfo_JsonCodec.circeDecoder(v.hcursor))
            publishedView <- getField(jsonObject, "publishedView").flatMap(v => decodeOption(ContentView_JsonCodec.circeDecoder)(v.hcursor))
            matchedView <- getField(jsonObject, "matchedView").flatMap(v => decodeOption(ContentView_JsonCodec.circeDecoder)(v.hcursor))
            lastTimestamp <- getField(jsonObject, "lastTimestamp").flatMap(v => decodeOption(decodeString)(v.hcursor))
            messageCount <- getField(jsonObject, "messageCount").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            tags <- getField(jsonObject, "tags").flatMap(v => decodeList(decodeString)(v.hcursor))
            headJob <- getField(jsonObject, "headJob").flatMap(v => decodeOption(JobInfo_JsonCodec.circeDecoder)(v.hcursor))
            publishedFormat <- getField(jsonObject, "publishedFormat").flatMap(v => decodeOption(PassageFormat_JsonCodec.circeDecoder)(v.hcursor))
          } yield ArchiveRow(head,publishedView,matchedView,lastTimestamp,messageCount,tags,headJob,publishedFormat)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ArchiveRow: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ArchiveRow.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ArchiveRow.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ArchiveRow.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ArchiveRow]] = Lazy(ArchiveRow_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ArchiveRow]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ArchiveRow] = LazyInstance.value
  }
}