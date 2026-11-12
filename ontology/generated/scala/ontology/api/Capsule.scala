import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class Capsule(
    id: UUID,
    requestId: UUID,
    owner: Actor,
    payload: CapsulePayload,
    payloadDigest: String,
    limits: CapsuleLimits,
    preparedAt: String,
    preparationTrace: RequestTrace
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
        "requestId" -> Json.fromString(value.requestId.toString()),
        "owner" -> Actor_JsonCodec.instance.encode(ctx, value.owner),
        "payload" -> CapsulePayload_JsonCodec.instance.encode(ctx, value.payload),
        "payloadDigest" -> Json.fromString(value.payloadDigest),
        "limits" -> CapsuleLimits_JsonCodec.instance.encode(ctx, value.limits),
        "preparedAt" -> Json.fromString(value.preparedAt),
        "preparationTrace" -> RequestTrace_JsonCodec.instance.encode(ctx, value.preparationTrace)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Capsule] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            owner <- getField(jsonObject, "owner").flatMap(v => Actor_JsonCodec.circeDecoder(v.hcursor))
            payload <- getField(jsonObject, "payload").flatMap(v => CapsulePayload_JsonCodec.circeDecoder(v.hcursor))
            payloadDigest <- getField(jsonObject, "payloadDigest").flatMap(v => decodeString(v.hcursor))
            limits <- getField(jsonObject, "limits").flatMap(v => CapsuleLimits_JsonCodec.circeDecoder(v.hcursor))
            preparedAt <- getField(jsonObject, "preparedAt").flatMap(v => decodeString(v.hcursor))
            preparationTrace <- getField(jsonObject, "preparationTrace").flatMap(v => RequestTrace_JsonCodec.circeDecoder(v.hcursor))
          } yield Capsule(id,requestId,owner,payload,payloadDigest,limits,preparedAt,preparationTrace)
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