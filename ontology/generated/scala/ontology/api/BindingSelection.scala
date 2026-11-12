import io.circe.Decoder.{decodeBoolean, decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class BindingSelection(
    ref: Ref,
    scope: String,
    binding: Ref,
    selected: Boolean,
    reason: String,
    basis: List[Ref],
    provenance: Provenance
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = BindingSelection.baboonDomainVersion
    override def baboonDomainIdentifier: String = BindingSelection.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = BindingSelection.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = BindingSelection.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = BindingSelection.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = BindingSelection.baboonMinReaderVersions
  }
  
  object BindingSelection {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#BindingSelection"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[BindingSelection] = BindingSelection_JsonCodec.instance
  }
  
  object BindingSelection_JsonCodec extends BaboonJsonCodec.BaseGenerated[BindingSelection, BaboonJsonCodec[BindingSelection]] {
    def encode(ctx: BaboonCodecContext, value: BindingSelection): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref),
        "scope" -> Json.fromString(value.scope),
        "binding" -> Ref_JsonCodec.instance.encode(ctx, value.binding),
        "selected" -> Json.fromBoolean(value.selected),
        "reason" -> Json.fromString(value.reason),
        "basis" -> Json.fromValues(value.basis.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "provenance" -> Provenance_JsonCodec.instance.encode(ctx, value.provenance)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, BindingSelection] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            binding <- getField(jsonObject, "binding").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            selected <- getField(jsonObject, "selected").flatMap(v => decodeBoolean(v.hcursor))
            reason <- getField(jsonObject, "reason").flatMap(v => decodeString(v.hcursor))
            basis <- getField(jsonObject, "basis").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            provenance <- getField(jsonObject, "provenance").flatMap(v => Provenance_JsonCodec.circeDecoder(v.hcursor))
          } yield BindingSelection(ref,scope,binding,selected,reason,basis,provenance)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to BindingSelection: object expected"))
      }
    }
  
    def baboonDomainVersion: String = BindingSelection.baboonDomainVersion
    
    def baboonDomainIdentifier: String = BindingSelection.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = BindingSelection.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[BindingSelection]] = Lazy(BindingSelection_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[BindingSelection]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[BindingSelection] = LazyInstance.value
  }
}