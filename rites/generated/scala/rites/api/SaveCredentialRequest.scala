import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package rites.api {
  final case class SaveCredentialRequest(
    id: Option[UUID],
    name: String,
    forge: ForgeKind,
    host: String,
    secret: String,
    expectedRevision: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SaveCredentialRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = SaveCredentialRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SaveCredentialRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SaveCredentialRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SaveCredentialRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SaveCredentialRequest.baboonMinReaderVersions
  }
  
  object SaveCredentialRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#SaveCredentialRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SaveCredentialRequest] = SaveCredentialRequest_JsonCodec.instance
  }
  
  object SaveCredentialRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[SaveCredentialRequest, BaboonJsonCodec[SaveCredentialRequest]] {
    def encode(ctx: BaboonCodecContext, value: SaveCredentialRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> value.id.map(v => Json.fromString(v.toString())).getOrElse(Json.Null),
        "name" -> Json.fromString(value.name),
        "forge" -> ForgeKind_JsonCodec.instance.encode(ctx, value.forge),
        "host" -> Json.fromString(value.host),
        "secret" -> Json.fromString(value.secret),
        "expectedRevision" -> Json.fromInt(value.expectedRevision)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SaveCredentialRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeOption(decodeUUID)(v.hcursor))
            name <- getField(jsonObject, "name").flatMap(v => decodeString(v.hcursor))
            forge <- getField(jsonObject, "forge").flatMap(v => ForgeKind_JsonCodec.circeDecoder(v.hcursor))
            host <- getField(jsonObject, "host").flatMap(v => decodeString(v.hcursor))
            secret <- getField(jsonObject, "secret").flatMap(v => decodeString(v.hcursor))
            expectedRevision <- getField(jsonObject, "expectedRevision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield SaveCredentialRequest(id,name,forge,host,secret,expectedRevision)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SaveCredentialRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SaveCredentialRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SaveCredentialRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SaveCredentialRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SaveCredentialRequest]] = Lazy(SaveCredentialRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SaveCredentialRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SaveCredentialRequest] = LazyInstance.value
  }
}