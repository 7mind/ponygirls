import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_2_0 {
  @deprecated("Version 1.2.0 is deprecated, you should migrate to 1.8.0")
  final case class SearchFilter(
    project: Option[String],
    gitBranch: Option[String],
    after: Option[String],
    before: Option[String],
    tags: List[String]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = SearchFilter.baboonDomainVersion
    override def baboonDomainIdentifier: String = SearchFilter.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SearchFilter.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SearchFilter.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SearchFilter.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SearchFilter.baboonMinReaderVersions
  }
  
  object SearchFilter {
    def baboonDomainVersion: String = "1.2.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#SearchFilter"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.2.0" -> "identical", "1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[SearchFilter] = SearchFilter_JsonCodec.instance
  }
  
  @deprecated("Version 1.2.0 is deprecated, you should migrate to 1.8.0")
  object SearchFilter_JsonCodec extends BaboonJsonCodec.BaseGenerated[SearchFilter, BaboonJsonCodec[SearchFilter]] {
    def encode(ctx: BaboonCodecContext, value: SearchFilter): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "project" -> value.project.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "gitBranch" -> value.gitBranch.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "after" -> value.after.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "before" -> value.before.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "tags" -> Json.fromValues(value.tags.map(e => Json.fromString(e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SearchFilter] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            project <- getField(jsonObject, "project").flatMap(v => decodeOption(decodeString)(v.hcursor))
            gitBranch <- getField(jsonObject, "gitBranch").flatMap(v => decodeOption(decodeString)(v.hcursor))
            after <- getField(jsonObject, "after").flatMap(v => decodeOption(decodeString)(v.hcursor))
            before <- getField(jsonObject, "before").flatMap(v => decodeOption(decodeString)(v.hcursor))
            tags <- getField(jsonObject, "tags").flatMap(v => decodeList(decodeString)(v.hcursor))
          } yield SearchFilter(project,gitBranch,after,before,tags)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SearchFilter: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SearchFilter.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SearchFilter.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SearchFilter.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SearchFilter]] = Lazy(SearchFilter_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SearchFilter]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SearchFilter] = LazyInstance.value
  }
}