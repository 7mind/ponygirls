import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ReportedInheritance(
    kind: InheritanceKind,
    sourceScope: String,
    generation: Long,
    sourceFrontier: Long,
    coveredFrontier: Long,
    bindingRefs: List[Ref],
    sourceRefs: List[Ref],
    anchor: Option[InheritanceAnchor]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ReportedInheritance.baboonDomainVersion
    override def baboonDomainIdentifier: String = ReportedInheritance.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ReportedInheritance.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ReportedInheritance.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ReportedInheritance.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ReportedInheritance.baboonMinReaderVersions
  }
  
  object ReportedInheritance {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ReportedInheritance"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ReportedInheritance] = ReportedInheritance_JsonCodec.instance
  }
  
  object ReportedInheritance_JsonCodec extends BaboonJsonCodec.BaseGenerated[ReportedInheritance, BaboonJsonCodec[ReportedInheritance]] {
    def encode(ctx: BaboonCodecContext, value: ReportedInheritance): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "kind" -> InheritanceKind_JsonCodec.instance.encode(ctx, value.kind),
        "sourceScope" -> Json.fromString(value.sourceScope),
        "generation" -> Json.fromString(value.generation.toString),
        "sourceFrontier" -> Json.fromString(value.sourceFrontier.toString),
        "coveredFrontier" -> Json.fromString(value.coveredFrontier.toString),
        "bindingRefs" -> Json.fromValues(value.bindingRefs.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "sourceRefs" -> Json.fromValues(value.sourceRefs.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "anchor" -> value.anchor.map(v => InheritanceAnchor_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ReportedInheritance] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            kind <- getField(jsonObject, "kind").flatMap(v => InheritanceKind_JsonCodec.circeDecoder(v.hcursor))
            sourceScope <- getField(jsonObject, "sourceScope").flatMap(v => decodeString(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            sourceFrontier <- getField(jsonObject, "sourceFrontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            coveredFrontier <- getField(jsonObject, "coveredFrontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            bindingRefs <- getField(jsonObject, "bindingRefs").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            sourceRefs <- getField(jsonObject, "sourceRefs").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            anchor <- getField(jsonObject, "anchor").flatMap(v => decodeOption(InheritanceAnchor_JsonCodec.circeDecoder)(v.hcursor))
          } yield ReportedInheritance(kind,sourceScope,generation,sourceFrontier,coveredFrontier,bindingRefs,sourceRefs,anchor)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ReportedInheritance: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ReportedInheritance.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ReportedInheritance.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ReportedInheritance.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ReportedInheritance]] = Lazy(ReportedInheritance_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ReportedInheritance]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ReportedInheritance] = LazyInstance.value
  }
}