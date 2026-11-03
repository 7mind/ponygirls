import io.circe.Decoder.{decodeDouble, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class SearchEvidence(
    field: EvidenceField,
    path: Option[String],
    text: String,
    score: Double
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SearchEvidence.baboonDomainVersion
    override def baboonDomainIdentifier: String = SearchEvidence.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SearchEvidence.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SearchEvidence.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SearchEvidence.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SearchEvidence.baboonMinReaderVersions
  }
  
  object SearchEvidence {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#SearchEvidence"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SearchEvidence] = SearchEvidence_JsonCodec.instance
  }
  
  object SearchEvidence_JsonCodec extends BaboonJsonCodec.BaseGenerated[SearchEvidence, BaboonJsonCodec[SearchEvidence]] {
    def encode(ctx: BaboonCodecContext, value: SearchEvidence): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "field" -> EvidenceField_JsonCodec.instance.encode(ctx, value.field),
        "path" -> value.path.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "text" -> Json.fromString(value.text),
        "score" -> Json.fromDouble(value.score).get
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SearchEvidence] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            field <- getField(jsonObject, "field").flatMap(v => EvidenceField_JsonCodec.circeDecoder(v.hcursor))
            path <- getField(jsonObject, "path").flatMap(v => decodeOption(decodeString)(v.hcursor))
            text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
            score <- getField(jsonObject, "score").flatMap(v => decodeDouble(v.hcursor))
          } yield SearchEvidence(field,path,text,score)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SearchEvidence: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SearchEvidence.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SearchEvidence.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SearchEvidence.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SearchEvidence]] = Lazy(SearchEvidence_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SearchEvidence]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SearchEvidence] = LazyInstance.value
  }
}