import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CoordinatorLease(
    fence: CoordinatorFence,
    acquiredAt: String,
    renewedAt: String,
    expiresAt: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CoordinatorLease.baboonDomainVersion
    override def baboonDomainIdentifier: String = CoordinatorLease.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CoordinatorLease.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CoordinatorLease.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CoordinatorLease.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CoordinatorLease.baboonMinReaderVersions
  }
  
  object CoordinatorLease {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CoordinatorLease"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CoordinatorLease] = CoordinatorLease_JsonCodec.instance
  }
  
  object CoordinatorLease_JsonCodec extends BaboonJsonCodec.BaseGenerated[CoordinatorLease, BaboonJsonCodec[CoordinatorLease]] {
    def encode(ctx: BaboonCodecContext, value: CoordinatorLease): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "fence" -> CoordinatorFence_JsonCodec.instance.encode(ctx, value.fence),
        "acquiredAt" -> Json.fromString(value.acquiredAt),
        "renewedAt" -> Json.fromString(value.renewedAt),
        "expiresAt" -> Json.fromString(value.expiresAt)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CoordinatorLease] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            fence <- getField(jsonObject, "fence").flatMap(v => CoordinatorFence_JsonCodec.circeDecoder(v.hcursor))
            acquiredAt <- getField(jsonObject, "acquiredAt").flatMap(v => decodeString(v.hcursor))
            renewedAt <- getField(jsonObject, "renewedAt").flatMap(v => decodeString(v.hcursor))
            expiresAt <- getField(jsonObject, "expiresAt").flatMap(v => decodeString(v.hcursor))
          } yield CoordinatorLease(fence,acquiredAt,renewedAt,expiresAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CoordinatorLease: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CoordinatorLease.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CoordinatorLease.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CoordinatorLease.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CoordinatorLease]] = Lazy(CoordinatorLease_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CoordinatorLease]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CoordinatorLease] = LazyInstance.value
  }
}