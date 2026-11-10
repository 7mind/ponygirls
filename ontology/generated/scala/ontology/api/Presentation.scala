import io.circe.Decoder.{decodeList, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class Presentation(
    id: UUID,
    scope: String,
    generation: Long,
    targets: List[Ref],
    records: List[GraphRecord],
    sourceRefs: List[Ref],
    createdAt: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Presentation.baboonDomainVersion
    override def baboonDomainIdentifier: String = Presentation.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Presentation.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Presentation.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Presentation.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Presentation.baboonMinReaderVersions
  }
  
  object Presentation {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Presentation"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Presentation] = Presentation_JsonCodec.instance
  }
  
  object Presentation_JsonCodec extends BaboonJsonCodec.BaseGenerated[Presentation, BaboonJsonCodec[Presentation]] {
    def encode(ctx: BaboonCodecContext, value: Presentation): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "scope" -> Json.fromString(value.scope),
        "generation" -> Json.fromString(value.generation.toString),
        "targets" -> Json.fromValues(value.targets.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "records" -> Json.fromValues(value.records.map(e => GraphRecord_JsonCodec.instance.encode(ctx, e))),
        "sourceRefs" -> Json.fromValues(value.sourceRefs.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "createdAt" -> Json.fromString(value.createdAt)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Presentation] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            targets <- getField(jsonObject, "targets").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            records <- getField(jsonObject, "records").flatMap(v => decodeList(GraphRecord_JsonCodec.circeDecoder)(v.hcursor))
            sourceRefs <- getField(jsonObject, "sourceRefs").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            createdAt <- getField(jsonObject, "createdAt").flatMap(v => decodeString(v.hcursor))
          } yield Presentation(id,scope,generation,targets,records,sourceRefs,createdAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Presentation: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Presentation.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Presentation.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Presentation.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Presentation]] = Lazy(Presentation_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Presentation]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Presentation] = LazyInstance.value
  }
}