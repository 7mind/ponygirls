import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class Definition(
    ref: Ref,
    scope: String,
    applicability: Applicability,
    content: Content,
    standing: Standing,
    basis: List[Ref],
    changeReason: Option[String],
    provenance: Provenance
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Definition.baboonDomainVersion
    override def baboonDomainIdentifier: String = Definition.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Definition.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Definition.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Definition.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Definition.baboonMinReaderVersions
  }
  
  object Definition {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Definition"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Definition] = Definition_JsonCodec.instance
  }
  
  object Definition_JsonCodec extends BaboonJsonCodec.BaseGenerated[Definition, BaboonJsonCodec[Definition]] {
    def encode(ctx: BaboonCodecContext, value: Definition): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref),
        "scope" -> Json.fromString(value.scope),
        "applicability" -> Applicability_JsonCodec.instance.encode(ctx, value.applicability),
        "content" -> Content_JsonCodec.instance.encode(ctx, value.content),
        "standing" -> Standing_JsonCodec.instance.encode(ctx, value.standing),
        "basis" -> Json.fromValues(value.basis.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "changeReason" -> value.changeReason.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "provenance" -> Provenance_JsonCodec.instance.encode(ctx, value.provenance)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Definition] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            applicability <- getField(jsonObject, "applicability").flatMap(v => Applicability_JsonCodec.circeDecoder(v.hcursor))
            content <- getField(jsonObject, "content").flatMap(v => Content_JsonCodec.circeDecoder(v.hcursor))
            standing <- getField(jsonObject, "standing").flatMap(v => Standing_JsonCodec.circeDecoder(v.hcursor))
            basis <- getField(jsonObject, "basis").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            changeReason <- getField(jsonObject, "changeReason").flatMap(v => decodeOption(decodeString)(v.hcursor))
            provenance <- getField(jsonObject, "provenance").flatMap(v => Provenance_JsonCodec.circeDecoder(v.hcursor))
          } yield Definition(ref,scope,applicability,content,standing,basis,changeReason,provenance)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Definition: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Definition.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Definition.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Definition.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Definition]] = Lazy(Definition_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Definition]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Definition] = LazyInstance.value
  }
}