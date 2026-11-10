import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class Relation(
    ref: Ref,
    scope: String,
    kind: RelationKind,
    sources: List[Ref],
    targets: List[Ref],
    detail: RelationDetail,
    why: String,
    standing: Standing,
    provenance: Provenance
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Relation.baboonDomainVersion
    override def baboonDomainIdentifier: String = Relation.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Relation.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Relation.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Relation.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Relation.baboonMinReaderVersions
  }
  
  object Relation {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Relation"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Relation] = Relation_JsonCodec.instance
  }
  
  object Relation_JsonCodec extends BaboonJsonCodec.BaseGenerated[Relation, BaboonJsonCodec[Relation]] {
    def encode(ctx: BaboonCodecContext, value: Relation): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref),
        "scope" -> Json.fromString(value.scope),
        "kind" -> RelationKind_JsonCodec.instance.encode(ctx, value.kind),
        "sources" -> Json.fromValues(value.sources.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "targets" -> Json.fromValues(value.targets.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "detail" -> RelationDetail_JsonCodec.instance.encode(ctx, value.detail),
        "why" -> Json.fromString(value.why),
        "standing" -> Standing_JsonCodec.instance.encode(ctx, value.standing),
        "provenance" -> Provenance_JsonCodec.instance.encode(ctx, value.provenance)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Relation] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            kind <- getField(jsonObject, "kind").flatMap(v => RelationKind_JsonCodec.circeDecoder(v.hcursor))
            sources <- getField(jsonObject, "sources").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            targets <- getField(jsonObject, "targets").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            detail <- getField(jsonObject, "detail").flatMap(v => RelationDetail_JsonCodec.circeDecoder(v.hcursor))
            why <- getField(jsonObject, "why").flatMap(v => decodeString(v.hcursor))
            standing <- getField(jsonObject, "standing").flatMap(v => Standing_JsonCodec.circeDecoder(v.hcursor))
            provenance <- getField(jsonObject, "provenance").flatMap(v => Provenance_JsonCodec.circeDecoder(v.hcursor))
          } yield Relation(ref,scope,kind,sources,targets,detail,why,standing,provenance)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Relation: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Relation.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Relation.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Relation.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Relation]] = Lazy(Relation_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Relation]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Relation] = LazyInstance.value
  }
}