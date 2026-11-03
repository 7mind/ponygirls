import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class SearchFilter(
    visibility: Option[Visibility],
    kind: Option[ArtifactKind],
    createdByUser: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SearchFilter.baboonDomainVersion
    override def baboonDomainIdentifier: String = SearchFilter.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SearchFilter.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SearchFilter.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SearchFilter.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SearchFilter.baboonMinReaderVersions
  }
  
  object SearchFilter {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#SearchFilter"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SearchFilter] = SearchFilter_JsonCodec.instance
  }
  
  object SearchFilter_JsonCodec extends BaboonJsonCodec.BaseGenerated[SearchFilter, BaboonJsonCodec[SearchFilter]] {
    def encode(ctx: BaboonCodecContext, value: SearchFilter): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "visibility" -> value.visibility.map(v => Visibility_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "kind" -> value.kind.map(v => ArtifactKind_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "createdByUser" -> value.createdByUser.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SearchFilter] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            visibility <- getField(jsonObject, "visibility").flatMap(v => decodeOption(Visibility_JsonCodec.circeDecoder)(v.hcursor))
            kind <- getField(jsonObject, "kind").flatMap(v => decodeOption(ArtifactKind_JsonCodec.circeDecoder)(v.hcursor))
            createdByUser <- getField(jsonObject, "createdByUser").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield SearchFilter(visibility,kind,createdByUser)
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