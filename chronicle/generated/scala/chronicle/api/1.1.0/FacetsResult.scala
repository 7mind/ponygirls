import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_1_0 {
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.2.0")
  final case class FacetsResult(
    projects: List[Facet],
    branches: List[Facet],
    tags: List[Facet]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = FacetsResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = FacetsResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = FacetsResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = FacetsResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = FacetsResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = FacetsResult.baboonMinReaderVersions
  }
  
  object FacetsResult {
    def baboonDomainVersion: String = "1.1.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#FacetsResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical", "1.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[FacetsResult] = FacetsResult_JsonCodec.instance
  }
  
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.2.0")
  object FacetsResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[FacetsResult, BaboonJsonCodec[FacetsResult]] {
    def encode(ctx: BaboonCodecContext, value: FacetsResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "projects" -> Json.fromValues(value.projects.map(e => Facet_JsonCodec.instance.encode(ctx, e))),
        "branches" -> Json.fromValues(value.branches.map(e => Facet_JsonCodec.instance.encode(ctx, e))),
        "tags" -> Json.fromValues(value.tags.map(e => Facet_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, FacetsResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            projects <- getField(jsonObject, "projects").flatMap(v => decodeList(Facet_JsonCodec.circeDecoder)(v.hcursor))
            branches <- getField(jsonObject, "branches").flatMap(v => decodeList(Facet_JsonCodec.circeDecoder)(v.hcursor))
            tags <- getField(jsonObject, "tags").flatMap(v => decodeList(Facet_JsonCodec.circeDecoder)(v.hcursor))
          } yield FacetsResult(projects,branches,tags)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to FacetsResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = FacetsResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = FacetsResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = FacetsResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[FacetsResult]] = Lazy(FacetsResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[FacetsResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[FacetsResult] = LazyInstance.value
  }
}