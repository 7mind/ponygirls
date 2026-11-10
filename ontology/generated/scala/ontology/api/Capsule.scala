import io.circe.Decoder.{decodeList, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class Capsule(
    id: UUID,
    scope: String,
    generation: Long,
    frontier: Long,
    coveredFrontier: Long,
    context: CaptureContext,
    current: List[Definition],
    relations: List[Relation],
    observations: List[CapturedEvent],
    changes: List[GoverningChange],
    qualifications: List[String],
    text: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Capsule.baboonDomainVersion
    override def baboonDomainIdentifier: String = Capsule.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Capsule.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Capsule.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Capsule.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Capsule.baboonMinReaderVersions
  }
  
  object Capsule {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Capsule"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Capsule] = Capsule_JsonCodec.instance
  }
  
  object Capsule_JsonCodec extends BaboonJsonCodec.BaseGenerated[Capsule, BaboonJsonCodec[Capsule]] {
    def encode(ctx: BaboonCodecContext, value: Capsule): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "scope" -> Json.fromString(value.scope),
        "generation" -> Json.fromString(value.generation.toString),
        "frontier" -> Json.fromString(value.frontier.toString),
        "coveredFrontier" -> Json.fromString(value.coveredFrontier.toString),
        "context" -> CaptureContext_JsonCodec.instance.encode(ctx, value.context),
        "current" -> Json.fromValues(value.current.map(e => Definition_JsonCodec.instance.encode(ctx, e))),
        "relations" -> Json.fromValues(value.relations.map(e => Relation_JsonCodec.instance.encode(ctx, e))),
        "observations" -> Json.fromValues(value.observations.map(e => CapturedEvent_JsonCodec.instance.encode(ctx, e))),
        "changes" -> Json.fromValues(value.changes.map(e => GoverningChange_JsonCodec.instance.encode(ctx, e))),
        "qualifications" -> Json.fromValues(value.qualifications.map(e => Json.fromString(e))),
        "text" -> Json.fromString(value.text)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Capsule] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            coveredFrontier <- getField(jsonObject, "coveredFrontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            context <- getField(jsonObject, "context").flatMap(v => CaptureContext_JsonCodec.circeDecoder(v.hcursor))
            current <- getField(jsonObject, "current").flatMap(v => decodeList(Definition_JsonCodec.circeDecoder)(v.hcursor))
            relations <- getField(jsonObject, "relations").flatMap(v => decodeList(Relation_JsonCodec.circeDecoder)(v.hcursor))
            observations <- getField(jsonObject, "observations").flatMap(v => decodeList(CapturedEvent_JsonCodec.circeDecoder)(v.hcursor))
            changes <- getField(jsonObject, "changes").flatMap(v => decodeList(GoverningChange_JsonCodec.circeDecoder)(v.hcursor))
            qualifications <- getField(jsonObject, "qualifications").flatMap(v => decodeList(decodeString)(v.hcursor))
            text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
          } yield Capsule(id,scope,generation,frontier,coveredFrontier,context,current,relations,observations,changes,qualifications,text)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Capsule: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Capsule.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Capsule.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Capsule.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Capsule]] = Lazy(Capsule_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Capsule]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Capsule] = LazyInstance.value
  }
}