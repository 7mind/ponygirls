import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class CataloguePage(
    artifacts: List[Artifact],
    nextCursor: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CataloguePage.baboonDomainVersion
    override def baboonDomainIdentifier: String = CataloguePage.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CataloguePage.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CataloguePage.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CataloguePage.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CataloguePage.baboonMinReaderVersions
  }
  
  object CataloguePage {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#CataloguePage"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CataloguePage] = CataloguePage_JsonCodec.instance
  }
  
  object CataloguePage_JsonCodec extends BaboonJsonCodec.BaseGenerated[CataloguePage, BaboonJsonCodec[CataloguePage]] {
    def encode(ctx: BaboonCodecContext, value: CataloguePage): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "artifacts" -> Json.fromValues(value.artifacts.map(e => Artifact_JsonCodec.instance.encode(ctx, e))),
        "nextCursor" -> value.nextCursor.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CataloguePage] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            artifacts <- getField(jsonObject, "artifacts").flatMap(v => decodeList(Artifact_JsonCodec.circeDecoder)(v.hcursor))
            nextCursor <- getField(jsonObject, "nextCursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield CataloguePage(artifacts,nextCursor)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CataloguePage: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CataloguePage.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CataloguePage.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CataloguePage.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CataloguePage]] = Lazy(CataloguePage_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CataloguePage]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CataloguePage] = LazyInstance.value
  }
}