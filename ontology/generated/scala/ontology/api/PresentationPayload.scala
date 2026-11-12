import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class PresentationPayload(
    scope: String,
    generation: Long,
    targets: List[Ref],
    records: List[GraphRecord],
    sourceRefs: List[Ref],
    manifest: PresentationManifest
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = PresentationPayload.baboonDomainVersion
    override def baboonDomainIdentifier: String = PresentationPayload.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = PresentationPayload.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = PresentationPayload.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = PresentationPayload.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = PresentationPayload.baboonMinReaderVersions
  }
  
  object PresentationPayload {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#PresentationPayload"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[PresentationPayload] = PresentationPayload_JsonCodec.instance
  }
  
  object PresentationPayload_JsonCodec extends BaboonJsonCodec.BaseGenerated[PresentationPayload, BaboonJsonCodec[PresentationPayload]] {
    def encode(ctx: BaboonCodecContext, value: PresentationPayload): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "generation" -> Json.fromString(value.generation.toString),
        "targets" -> Json.fromValues(value.targets.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "records" -> Json.fromValues(value.records.map(e => GraphRecord_JsonCodec.instance.encode(ctx, e))),
        "sourceRefs" -> Json.fromValues(value.sourceRefs.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "manifest" -> PresentationManifest_JsonCodec.instance.encode(ctx, value.manifest)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PresentationPayload] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            targets <- getField(jsonObject, "targets").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            records <- getField(jsonObject, "records").flatMap(v => decodeList(GraphRecord_JsonCodec.circeDecoder)(v.hcursor))
            sourceRefs <- getField(jsonObject, "sourceRefs").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            manifest <- getField(jsonObject, "manifest").flatMap(v => PresentationManifest_JsonCodec.circeDecoder(v.hcursor))
          } yield PresentationPayload(scope,generation,targets,records,sourceRefs,manifest)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to PresentationPayload: object expected"))
      }
    }
  
    def baboonDomainVersion: String = PresentationPayload.baboonDomainVersion
    
    def baboonDomainIdentifier: String = PresentationPayload.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = PresentationPayload.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PresentationPayload]] = Lazy(PresentationPayload_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PresentationPayload]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PresentationPayload] = LazyInstance.value
  }
}