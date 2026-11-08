import io.circe.Decoder.{decodeBoolean, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class SaveRiteRequest(
    repositoryId: String,
    id: String,
    schedule: String,
    promptPath: String,
    modelId: String,
    enabled: Boolean,
    expectedRevision: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SaveRiteRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = SaveRiteRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SaveRiteRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SaveRiteRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SaveRiteRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SaveRiteRequest.baboonMinReaderVersions
  }
  
  object SaveRiteRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#SaveRiteRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SaveRiteRequest] = SaveRiteRequest_JsonCodec.instance
  }
  
  object SaveRiteRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[SaveRiteRequest, BaboonJsonCodec[SaveRiteRequest]] {
    def encode(ctx: BaboonCodecContext, value: SaveRiteRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "repositoryId" -> Json.fromString(value.repositoryId),
        "id" -> Json.fromString(value.id),
        "schedule" -> Json.fromString(value.schedule),
        "promptPath" -> Json.fromString(value.promptPath),
        "modelId" -> Json.fromString(value.modelId),
        "enabled" -> Json.fromBoolean(value.enabled),
        "expectedRevision" -> Json.fromInt(value.expectedRevision)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SaveRiteRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            repositoryId <- getField(jsonObject, "repositoryId").flatMap(v => decodeString(v.hcursor))
            id <- getField(jsonObject, "id").flatMap(v => decodeString(v.hcursor))
            schedule <- getField(jsonObject, "schedule").flatMap(v => decodeString(v.hcursor))
            promptPath <- getField(jsonObject, "promptPath").flatMap(v => decodeString(v.hcursor))
            modelId <- getField(jsonObject, "modelId").flatMap(v => decodeString(v.hcursor))
            enabled <- getField(jsonObject, "enabled").flatMap(v => decodeBoolean(v.hcursor))
            expectedRevision <- getField(jsonObject, "expectedRevision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield SaveRiteRequest(repositoryId,id,schedule,promptPath,modelId,enabled,expectedRevision)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SaveRiteRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SaveRiteRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SaveRiteRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SaveRiteRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SaveRiteRequest]] = Lazy(SaveRiteRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SaveRiteRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SaveRiteRequest] = LazyInstance.value
  }
}