import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_2_0 {
  @deprecated("Version 1.2.0 is deprecated, you should migrate to 1.5.0")
  final case class GroupsResult(
    groups: List[GroupInfo],
    invitations: List[InviteInfo]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = GroupsResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = GroupsResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = GroupsResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = GroupsResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = GroupsResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = GroupsResult.baboonMinReaderVersions
  }
  
  object GroupsResult {
    def baboonDomainVersion: String = "1.2.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#GroupsResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.2.0" -> "identical", "1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[GroupsResult] = GroupsResult_JsonCodec.instance
  }
  
  @deprecated("Version 1.2.0 is deprecated, you should migrate to 1.5.0")
  object GroupsResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[GroupsResult, BaboonJsonCodec[GroupsResult]] {
    def encode(ctx: BaboonCodecContext, value: GroupsResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "groups" -> Json.fromValues(value.groups.map(e => GroupInfo_JsonCodec.instance.encode(ctx, e))),
        "invitations" -> Json.fromValues(value.invitations.map(e => InviteInfo_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GroupsResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            groups <- getField(jsonObject, "groups").flatMap(v => decodeList(GroupInfo_JsonCodec.circeDecoder)(v.hcursor))
            invitations <- getField(jsonObject, "invitations").flatMap(v => decodeList(InviteInfo_JsonCodec.circeDecoder)(v.hcursor))
          } yield GroupsResult(groups,invitations)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to GroupsResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = GroupsResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = GroupsResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = GroupsResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GroupsResult]] = Lazy(GroupsResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[GroupsResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[GroupsResult] = LazyInstance.value
  }
}