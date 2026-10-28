import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}
import java.util.UUID

package chronicle.api.v1_0_0 {
  @deprecated("Version 1.0.0 is deprecated, you should migrate to 1.7.0")
  final case class MutationReceipt(
    requestId: UUID,
    operation: String,
    entityId: Option[UUID]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = MutationReceipt.baboonDomainVersion
    override def baboonDomainIdentifier: String = MutationReceipt.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = MutationReceipt.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = MutationReceipt.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = MutationReceipt.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = MutationReceipt.baboonMinReaderVersions
  }
  
  object MutationReceipt {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#MutationReceipt"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical", "1.1.0" -> "identical", "1.2.0" -> "identical", "1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[MutationReceipt] = MutationReceipt_JsonCodec.instance
  }
  
  @deprecated("Version 1.0.0 is deprecated, you should migrate to 1.7.0")
  object MutationReceipt_JsonCodec extends BaboonJsonCodec.BaseGenerated[MutationReceipt, BaboonJsonCodec[MutationReceipt]] {
    def encode(ctx: BaboonCodecContext, value: MutationReceipt): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "requestId" -> Json.fromString(value.requestId.toString()),
        "operation" -> Json.fromString(value.operation),
        "entityId" -> value.entityId.map(v => Json.fromString(v.toString())).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, MutationReceipt] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            operation <- getField(jsonObject, "operation").flatMap(v => decodeString(v.hcursor))
            entityId <- getField(jsonObject, "entityId").flatMap(v => decodeOption(decodeUUID)(v.hcursor))
          } yield MutationReceipt(requestId,operation,entityId)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to MutationReceipt: object expected"))
      }
    }
  
    def baboonDomainVersion: String = MutationReceipt.baboonDomainVersion
    
    def baboonDomainIdentifier: String = MutationReceipt.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = MutationReceipt.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[MutationReceipt]] = Lazy(MutationReceipt_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[MutationReceipt]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[MutationReceipt] = LazyInstance.value
  }
}