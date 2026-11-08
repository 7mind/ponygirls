import io.circe.Decoder.{decodeList, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package rites.api {
  final case class RepositoryInfo(
    id: String,
    owner: String,
    forge: ForgeKind,
    host: String,
    project: String,
    baseBranch: String,
    credentialId: UUID,
    revision: Int,
    grants: List[GrantInfo]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RepositoryInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = RepositoryInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RepositoryInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RepositoryInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RepositoryInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RepositoryInfo.baboonMinReaderVersions
  }
  
  object RepositoryInfo {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#RepositoryInfo"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RepositoryInfo] = RepositoryInfo_JsonCodec.instance
  }
  
  object RepositoryInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[RepositoryInfo, BaboonJsonCodec[RepositoryInfo]] {
    def encode(ctx: BaboonCodecContext, value: RepositoryInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id),
        "owner" -> Json.fromString(value.owner),
        "forge" -> ForgeKind_JsonCodec.instance.encode(ctx, value.forge),
        "host" -> Json.fromString(value.host),
        "project" -> Json.fromString(value.project),
        "baseBranch" -> Json.fromString(value.baseBranch),
        "credentialId" -> Json.fromString(value.credentialId.toString()),
        "revision" -> Json.fromInt(value.revision),
        "grants" -> Json.fromValues(value.grants.map(e => GrantInfo_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RepositoryInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeString(v.hcursor))
            owner <- getField(jsonObject, "owner").flatMap(v => decodeString(v.hcursor))
            forge <- getField(jsonObject, "forge").flatMap(v => ForgeKind_JsonCodec.circeDecoder(v.hcursor))
            host <- getField(jsonObject, "host").flatMap(v => decodeString(v.hcursor))
            project <- getField(jsonObject, "project").flatMap(v => decodeString(v.hcursor))
            baseBranch <- getField(jsonObject, "baseBranch").flatMap(v => decodeString(v.hcursor))
            credentialId <- getField(jsonObject, "credentialId").flatMap(v => decodeUUID(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            grants <- getField(jsonObject, "grants").flatMap(v => decodeList(GrantInfo_JsonCodec.circeDecoder)(v.hcursor))
          } yield RepositoryInfo(id,owner,forge,host,project,baseBranch,credentialId,revision,grants)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RepositoryInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RepositoryInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RepositoryInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RepositoryInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RepositoryInfo]] = Lazy(RepositoryInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RepositoryInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RepositoryInfo] = LazyInstance.value
  }
}