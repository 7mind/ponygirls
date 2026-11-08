import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package rites.api {
  final case class ManualRunRequest(
    repositoryId: String,
    riteId: String,
    requestId: UUID
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ManualRunRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = ManualRunRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ManualRunRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ManualRunRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ManualRunRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ManualRunRequest.baboonMinReaderVersions
  }
  
  object ManualRunRequest {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#ManualRunRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ManualRunRequest] = ManualRunRequest_JsonCodec.instance
  }
  
  object ManualRunRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[ManualRunRequest, BaboonJsonCodec[ManualRunRequest]] {
    def encode(ctx: BaboonCodecContext, value: ManualRunRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "repositoryId" -> Json.fromString(value.repositoryId),
        "riteId" -> Json.fromString(value.riteId),
        "requestId" -> Json.fromString(value.requestId.toString())
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ManualRunRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            repositoryId <- getField(jsonObject, "repositoryId").flatMap(v => decodeString(v.hcursor))
            riteId <- getField(jsonObject, "riteId").flatMap(v => decodeString(v.hcursor))
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
          } yield ManualRunRequest(repositoryId,riteId,requestId)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ManualRunRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ManualRunRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ManualRunRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ManualRunRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ManualRunRequest]] = Lazy(ManualRunRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ManualRunRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ManualRunRequest] = LazyInstance.value
  }
}