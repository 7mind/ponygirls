import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class OAuthClientInfo(
    id: String,
    forge: ForgeKind,
    host: String,
    label: String,
    expiryLeadSeconds: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = OAuthClientInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = OAuthClientInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = OAuthClientInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = OAuthClientInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = OAuthClientInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = OAuthClientInfo.baboonMinReaderVersions
  }
  
  object OAuthClientInfo {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#OAuthClientInfo"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[OAuthClientInfo] = OAuthClientInfo_JsonCodec.instance
  }
  
  object OAuthClientInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[OAuthClientInfo, BaboonJsonCodec[OAuthClientInfo]] {
    def encode(ctx: BaboonCodecContext, value: OAuthClientInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id),
        "forge" -> ForgeKind_JsonCodec.instance.encode(ctx, value.forge),
        "host" -> Json.fromString(value.host),
        "label" -> Json.fromString(value.label),
        "expiryLeadSeconds" -> Json.fromInt(value.expiryLeadSeconds)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, OAuthClientInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeString(v.hcursor))
            forge <- getField(jsonObject, "forge").flatMap(v => ForgeKind_JsonCodec.circeDecoder(v.hcursor))
            host <- getField(jsonObject, "host").flatMap(v => decodeString(v.hcursor))
            label <- getField(jsonObject, "label").flatMap(v => decodeString(v.hcursor))
            expiryLeadSeconds <- getField(jsonObject, "expiryLeadSeconds").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield OAuthClientInfo(id,forge,host,label,expiryLeadSeconds)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to OAuthClientInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = OAuthClientInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = OAuthClientInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = OAuthClientInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[OAuthClientInfo]] = Lazy(OAuthClientInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[OAuthClientInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[OAuthClientInfo] = LazyInstance.value
  }
}