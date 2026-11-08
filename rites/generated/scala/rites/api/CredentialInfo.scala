import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package rites.api {
  final case class CredentialInfo(
    id: UUID,
    name: String,
    forge: ForgeKind,
    host: String,
    revision: Int,
    createdAt: String,
    updatedAt: String,
    mode: CredentialMode,
    oauthClientId: Option[String],
    expiresAt: Option[String],
    refreshHealth: Option[RefreshHealth]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CredentialInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = CredentialInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CredentialInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CredentialInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CredentialInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CredentialInfo.baboonMinReaderVersions
  }
  
  object CredentialInfo {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#CredentialInfo"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CredentialInfo] = CredentialInfo_JsonCodec.instance
  }
  
  object CredentialInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[CredentialInfo, BaboonJsonCodec[CredentialInfo]] {
    def encode(ctx: BaboonCodecContext, value: CredentialInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "name" -> Json.fromString(value.name),
        "forge" -> ForgeKind_JsonCodec.instance.encode(ctx, value.forge),
        "host" -> Json.fromString(value.host),
        "revision" -> Json.fromInt(value.revision),
        "createdAt" -> Json.fromString(value.createdAt),
        "updatedAt" -> Json.fromString(value.updatedAt),
        "mode" -> CredentialMode_JsonCodec.instance.encode(ctx, value.mode),
        "oauthClientId" -> value.oauthClientId.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "expiresAt" -> value.expiresAt.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "refreshHealth" -> value.refreshHealth.map(v => RefreshHealth_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CredentialInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            name <- getField(jsonObject, "name").flatMap(v => decodeString(v.hcursor))
            forge <- getField(jsonObject, "forge").flatMap(v => ForgeKind_JsonCodec.circeDecoder(v.hcursor))
            host <- getField(jsonObject, "host").flatMap(v => decodeString(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            createdAt <- getField(jsonObject, "createdAt").flatMap(v => decodeString(v.hcursor))
            updatedAt <- getField(jsonObject, "updatedAt").flatMap(v => decodeString(v.hcursor))
            mode <- getField(jsonObject, "mode").flatMap(v => CredentialMode_JsonCodec.circeDecoder(v.hcursor))
            oauthClientId <- getField(jsonObject, "oauthClientId").flatMap(v => decodeOption(decodeString)(v.hcursor))
            expiresAt <- getField(jsonObject, "expiresAt").flatMap(v => decodeOption(decodeString)(v.hcursor))
            refreshHealth <- getField(jsonObject, "refreshHealth").flatMap(v => decodeOption(RefreshHealth_JsonCodec.circeDecoder)(v.hcursor))
          } yield CredentialInfo(id,name,forge,host,revision,createdAt,updatedAt,mode,oauthClientId,expiresAt,refreshHealth)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CredentialInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CredentialInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CredentialInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CredentialInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CredentialInfo]] = Lazy(CredentialInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CredentialInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CredentialInfo] = LazyInstance.value
  }
}