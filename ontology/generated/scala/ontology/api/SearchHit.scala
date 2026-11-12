import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class SearchHit(
    ref: Ref,
    kind: String,
    text: String,
    standing: Standing,
    applicability: Applicability
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SearchHit.baboonDomainVersion
    override def baboonDomainIdentifier: String = SearchHit.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SearchHit.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SearchHit.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SearchHit.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SearchHit.baboonMinReaderVersions
  }
  
  object SearchHit {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#SearchHit"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SearchHit] = SearchHit_JsonCodec.instance
  }
  
  object SearchHit_JsonCodec extends BaboonJsonCodec.BaseGenerated[SearchHit, BaboonJsonCodec[SearchHit]] {
    def encode(ctx: BaboonCodecContext, value: SearchHit): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref),
        "kind" -> Json.fromString(value.kind),
        "text" -> Json.fromString(value.text),
        "standing" -> Standing_JsonCodec.instance.encode(ctx, value.standing),
        "applicability" -> Applicability_JsonCodec.instance.encode(ctx, value.applicability)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SearchHit] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            kind <- getField(jsonObject, "kind").flatMap(v => decodeString(v.hcursor))
            text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
            standing <- getField(jsonObject, "standing").flatMap(v => Standing_JsonCodec.circeDecoder(v.hcursor))
            applicability <- getField(jsonObject, "applicability").flatMap(v => Applicability_JsonCodec.circeDecoder(v.hcursor))
          } yield SearchHit(ref,kind,text,standing,applicability)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SearchHit: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SearchHit.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SearchHit.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SearchHit.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SearchHit]] = Lazy(SearchHit_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SearchHit]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SearchHit] = LazyInstance.value
  }
}