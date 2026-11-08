import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package rites.api {
  final case class SaveRepositoryRequest(
    id: String,
    forge: ForgeKind,
    host: String,
    project: String,
    baseBranch: String,
    credentialId: UUID,
    expectedRevision: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SaveRepositoryRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = SaveRepositoryRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SaveRepositoryRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SaveRepositoryRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SaveRepositoryRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SaveRepositoryRequest.baboonMinReaderVersions
  }
  
  object SaveRepositoryRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#SaveRepositoryRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SaveRepositoryRequest] = SaveRepositoryRequest_JsonCodec.instance
  }
  
  object SaveRepositoryRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[SaveRepositoryRequest, BaboonJsonCodec[SaveRepositoryRequest]] {
    def encode(ctx: BaboonCodecContext, value: SaveRepositoryRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id),
        "forge" -> ForgeKind_JsonCodec.instance.encode(ctx, value.forge),
        "host" -> Json.fromString(value.host),
        "project" -> Json.fromString(value.project),
        "baseBranch" -> Json.fromString(value.baseBranch),
        "credentialId" -> Json.fromString(value.credentialId.toString()),
        "expectedRevision" -> Json.fromInt(value.expectedRevision)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SaveRepositoryRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeString(v.hcursor))
            forge <- getField(jsonObject, "forge").flatMap(v => ForgeKind_JsonCodec.circeDecoder(v.hcursor))
            host <- getField(jsonObject, "host").flatMap(v => decodeString(v.hcursor))
            project <- getField(jsonObject, "project").flatMap(v => decodeString(v.hcursor))
            baseBranch <- getField(jsonObject, "baseBranch").flatMap(v => decodeString(v.hcursor))
            credentialId <- getField(jsonObject, "credentialId").flatMap(v => decodeUUID(v.hcursor))
            expectedRevision <- getField(jsonObject, "expectedRevision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield SaveRepositoryRequest(id,forge,host,project,baseBranch,credentialId,expectedRevision)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SaveRepositoryRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SaveRepositoryRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SaveRepositoryRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SaveRepositoryRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SaveRepositoryRequest]] = Lazy(SaveRepositoryRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SaveRepositoryRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SaveRepositoryRequest] = LazyInstance.value
  }
}