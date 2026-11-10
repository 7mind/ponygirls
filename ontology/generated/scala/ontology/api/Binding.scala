import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class Binding(
    ref: Ref,
    scope: String,
    definition: Ref,
    context: List[Ref],
    provenance: Provenance
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Binding.baboonDomainVersion
    override def baboonDomainIdentifier: String = Binding.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Binding.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Binding.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Binding.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Binding.baboonMinReaderVersions
  }
  
  object Binding {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Binding"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Binding] = Binding_JsonCodec.instance
  }
  
  object Binding_JsonCodec extends BaboonJsonCodec.BaseGenerated[Binding, BaboonJsonCodec[Binding]] {
    def encode(ctx: BaboonCodecContext, value: Binding): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref),
        "scope" -> Json.fromString(value.scope),
        "definition" -> Ref_JsonCodec.instance.encode(ctx, value.definition),
        "context" -> Json.fromValues(value.context.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "provenance" -> Provenance_JsonCodec.instance.encode(ctx, value.provenance)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Binding] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            definition <- getField(jsonObject, "definition").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            context <- getField(jsonObject, "context").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            provenance <- getField(jsonObject, "provenance").flatMap(v => Provenance_JsonCodec.circeDecoder(v.hcursor))
          } yield Binding(ref,scope,definition,context,provenance)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Binding: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Binding.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Binding.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Binding.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Binding]] = Lazy(Binding_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Binding]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Binding] = LazyInstance.value
  }
}