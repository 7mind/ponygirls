import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_4_0 {
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.5.0")
  final case class OwnerReindexPlan(
    currentTargetProfile: String,
    targetProfile: String,
    selectionHash: String,
    heads: Long,
    alreadyCurrent: Long,
    replacements: Long
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = OwnerReindexPlan.baboonDomainVersion
    override def baboonDomainIdentifier: String = OwnerReindexPlan.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = OwnerReindexPlan.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = OwnerReindexPlan.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = OwnerReindexPlan.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = OwnerReindexPlan.baboonMinReaderVersions
  }
  
  object OwnerReindexPlan {
    def baboonDomainVersion: String = "1.4.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#OwnerReindexPlan"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical", "1.5.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[OwnerReindexPlan] = OwnerReindexPlan_JsonCodec.instance
  }
  
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.5.0")
  object OwnerReindexPlan_JsonCodec extends BaboonJsonCodec.BaseGenerated[OwnerReindexPlan, BaboonJsonCodec[OwnerReindexPlan]] {
    def encode(ctx: BaboonCodecContext, value: OwnerReindexPlan): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "currentTargetProfile" -> Json.fromString(value.currentTargetProfile),
        "targetProfile" -> Json.fromString(value.targetProfile),
        "selectionHash" -> Json.fromString(value.selectionHash),
        "heads" -> Json.fromString(value.heads.toString),
        "alreadyCurrent" -> Json.fromString(value.alreadyCurrent.toString),
        "replacements" -> Json.fromString(value.replacements.toString)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, OwnerReindexPlan] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            currentTargetProfile <- getField(jsonObject, "currentTargetProfile").flatMap(v => decodeString(v.hcursor))
            targetProfile <- getField(jsonObject, "targetProfile").flatMap(v => decodeString(v.hcursor))
            selectionHash <- getField(jsonObject, "selectionHash").flatMap(v => decodeString(v.hcursor))
            heads <- getField(jsonObject, "heads").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            alreadyCurrent <- getField(jsonObject, "alreadyCurrent").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            replacements <- getField(jsonObject, "replacements").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
          } yield OwnerReindexPlan(currentTargetProfile,targetProfile,selectionHash,heads,alreadyCurrent,replacements)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to OwnerReindexPlan: object expected"))
      }
    }
  
    def baboonDomainVersion: String = OwnerReindexPlan.baboonDomainVersion
    
    def baboonDomainIdentifier: String = OwnerReindexPlan.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = OwnerReindexPlan.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[OwnerReindexPlan]] = Lazy(OwnerReindexPlan_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[OwnerReindexPlan]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[OwnerReindexPlan] = LazyInstance.value
  }
}