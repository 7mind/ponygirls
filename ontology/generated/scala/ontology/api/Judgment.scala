import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class Judgment(
    id: UUID,
    scope: String,
    presentationId: UUID,
    kind: JudgmentKind,
    rationale: String,
    actor: Actor,
    recordedAt: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Judgment.baboonDomainVersion
    override def baboonDomainIdentifier: String = Judgment.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Judgment.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Judgment.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Judgment.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Judgment.baboonMinReaderVersions
  }
  
  object Judgment {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Judgment"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Judgment] = Judgment_JsonCodec.instance
  }
  
  object Judgment_JsonCodec extends BaboonJsonCodec.BaseGenerated[Judgment, BaboonJsonCodec[Judgment]] {
    def encode(ctx: BaboonCodecContext, value: Judgment): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "scope" -> Json.fromString(value.scope),
        "presentationId" -> Json.fromString(value.presentationId.toString()),
        "kind" -> JudgmentKind_JsonCodec.instance.encode(ctx, value.kind),
        "rationale" -> Json.fromString(value.rationale),
        "actor" -> Actor_JsonCodec.instance.encode(ctx, value.actor),
        "recordedAt" -> Json.fromString(value.recordedAt)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Judgment] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            presentationId <- getField(jsonObject, "presentationId").flatMap(v => decodeUUID(v.hcursor))
            kind <- getField(jsonObject, "kind").flatMap(v => JudgmentKind_JsonCodec.circeDecoder(v.hcursor))
            rationale <- getField(jsonObject, "rationale").flatMap(v => decodeString(v.hcursor))
            actor <- getField(jsonObject, "actor").flatMap(v => Actor_JsonCodec.circeDecoder(v.hcursor))
            recordedAt <- getField(jsonObject, "recordedAt").flatMap(v => decodeString(v.hcursor))
          } yield Judgment(id,scope,presentationId,kind,rationale,actor,recordedAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Judgment: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Judgment.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Judgment.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Judgment.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Judgment]] = Lazy(Judgment_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Judgment]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Judgment] = LazyInstance.value
  }
}