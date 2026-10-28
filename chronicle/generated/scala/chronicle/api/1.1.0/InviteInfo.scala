import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}
import java.util.UUID

package chronicle.api.v1_1_0 {
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.7.0")
  final case class InviteInfo(
    id: UUID,
    groupId: UUID,
    targetId: String,
    expiresAt: String
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = InviteInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = InviteInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = InviteInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = InviteInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = InviteInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = InviteInfo.baboonMinReaderVersions
  }
  
  object InviteInfo {
    def baboonDomainVersion: String = "1.1.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#InviteInfo"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical", "1.2.0" -> "identical", "1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[InviteInfo] = InviteInfo_JsonCodec.instance
  }
  
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.7.0")
  object InviteInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[InviteInfo, BaboonJsonCodec[InviteInfo]] {
    def encode(ctx: BaboonCodecContext, value: InviteInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "groupId" -> Json.fromString(value.groupId.toString()),
        "targetId" -> Json.fromString(value.targetId),
        "expiresAt" -> Json.fromString(value.expiresAt)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, InviteInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            groupId <- getField(jsonObject, "groupId").flatMap(v => decodeUUID(v.hcursor))
            targetId <- getField(jsonObject, "targetId").flatMap(v => decodeString(v.hcursor))
            expiresAt <- getField(jsonObject, "expiresAt").flatMap(v => decodeString(v.hcursor))
          } yield InviteInfo(id,groupId,targetId,expiresAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to InviteInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = InviteInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = InviteInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = InviteInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[InviteInfo]] = Lazy(InviteInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[InviteInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[InviteInfo] = LazyInstance.value
  }
}