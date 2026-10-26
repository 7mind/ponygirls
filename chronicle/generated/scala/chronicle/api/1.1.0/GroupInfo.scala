import io.circe.Decoder.{decodeList, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}
import java.util.UUID

package chronicle.api.v1_1_0 {
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.4.0")
  final case class GroupInfo(
    id: UUID,
    name: String,
    ownerId: String,
    members: List[String]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = GroupInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = GroupInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = GroupInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = GroupInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = GroupInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = GroupInfo.baboonMinReaderVersions
  }
  
  object GroupInfo {
    def baboonDomainVersion: String = "1.1.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#GroupInfo"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical", "1.2.0" -> "identical", "1.3.0" -> "identical", "1.4.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[GroupInfo] = GroupInfo_JsonCodec.instance
  }
  
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.4.0")
  object GroupInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[GroupInfo, BaboonJsonCodec[GroupInfo]] {
    def encode(ctx: BaboonCodecContext, value: GroupInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "name" -> Json.fromString(value.name),
        "ownerId" -> Json.fromString(value.ownerId),
        "members" -> Json.fromValues(value.members.map(e => Json.fromString(e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GroupInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            name <- getField(jsonObject, "name").flatMap(v => decodeString(v.hcursor))
            ownerId <- getField(jsonObject, "ownerId").flatMap(v => decodeString(v.hcursor))
            members <- getField(jsonObject, "members").flatMap(v => decodeList(decodeString)(v.hcursor))
          } yield GroupInfo(id,name,ownerId,members)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to GroupInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = GroupInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = GroupInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = GroupInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GroupInfo]] = Lazy(GroupInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[GroupInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[GroupInfo] = LazyInstance.value
  }
}