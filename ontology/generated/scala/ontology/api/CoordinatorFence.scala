import io.circe.Decoder.decodeUUID
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class CoordinatorFence(
    ownerId: UUID,
    epoch: Long
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CoordinatorFence.baboonDomainVersion
    override def baboonDomainIdentifier: String = CoordinatorFence.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CoordinatorFence.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CoordinatorFence.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CoordinatorFence.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CoordinatorFence.baboonMinReaderVersions
  }
  
  object CoordinatorFence {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CoordinatorFence"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CoordinatorFence] = CoordinatorFence_JsonCodec.instance
  }
  
  object CoordinatorFence_JsonCodec extends BaboonJsonCodec.BaseGenerated[CoordinatorFence, BaboonJsonCodec[CoordinatorFence]] {
    def encode(ctx: BaboonCodecContext, value: CoordinatorFence): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "ownerId" -> Json.fromString(value.ownerId.toString()),
        "epoch" -> Json.fromString(value.epoch.toString)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CoordinatorFence] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            ownerId <- getField(jsonObject, "ownerId").flatMap(v => decodeUUID(v.hcursor))
            epoch <- getField(jsonObject, "epoch").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
          } yield CoordinatorFence(ownerId,epoch)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CoordinatorFence: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CoordinatorFence.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CoordinatorFence.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CoordinatorFence.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CoordinatorFence]] = Lazy(CoordinatorFence_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CoordinatorFence]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CoordinatorFence] = LazyInstance.value
  }
}