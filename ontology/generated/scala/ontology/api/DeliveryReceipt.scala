import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class DeliveryReceipt(
    id: UUID,
    capsuleId: UUID,
    generation: Long,
    frontier: Long,
    payloadDigest: String,
    recordedAt: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = DeliveryReceipt.baboonDomainVersion
    override def baboonDomainIdentifier: String = DeliveryReceipt.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = DeliveryReceipt.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = DeliveryReceipt.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = DeliveryReceipt.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = DeliveryReceipt.baboonMinReaderVersions
  }
  
  object DeliveryReceipt {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#DeliveryReceipt"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[DeliveryReceipt] = DeliveryReceipt_JsonCodec.instance
  }
  
  object DeliveryReceipt_JsonCodec extends BaboonJsonCodec.BaseGenerated[DeliveryReceipt, BaboonJsonCodec[DeliveryReceipt]] {
    def encode(ctx: BaboonCodecContext, value: DeliveryReceipt): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "capsuleId" -> Json.fromString(value.capsuleId.toString()),
        "generation" -> Json.fromString(value.generation.toString),
        "frontier" -> Json.fromString(value.frontier.toString),
        "payloadDigest" -> Json.fromString(value.payloadDigest),
        "recordedAt" -> Json.fromString(value.recordedAt)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, DeliveryReceipt] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            capsuleId <- getField(jsonObject, "capsuleId").flatMap(v => decodeUUID(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            frontier <- getField(jsonObject, "frontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            payloadDigest <- getField(jsonObject, "payloadDigest").flatMap(v => decodeString(v.hcursor))
            recordedAt <- getField(jsonObject, "recordedAt").flatMap(v => decodeString(v.hcursor))
          } yield DeliveryReceipt(id,capsuleId,generation,frontier,payloadDigest,recordedAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to DeliveryReceipt: object expected"))
      }
    }
  
    def baboonDomainVersion: String = DeliveryReceipt.baboonDomainVersion
    
    def baboonDomainIdentifier: String = DeliveryReceipt.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = DeliveryReceipt.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[DeliveryReceipt]] = Lazy(DeliveryReceipt_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[DeliveryReceipt]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[DeliveryReceipt] = LazyInstance.value
  }
}