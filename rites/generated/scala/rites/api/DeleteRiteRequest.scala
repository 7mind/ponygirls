import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class DeleteRiteRequest(
    repositoryId: String,
    id: String,
    expectedRevision: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = DeleteRiteRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = DeleteRiteRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = DeleteRiteRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = DeleteRiteRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = DeleteRiteRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = DeleteRiteRequest.baboonMinReaderVersions
  }
  
  object DeleteRiteRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#DeleteRiteRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[DeleteRiteRequest] = DeleteRiteRequest_JsonCodec.instance
  }
  
  object DeleteRiteRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[DeleteRiteRequest, BaboonJsonCodec[DeleteRiteRequest]] {
    def encode(ctx: BaboonCodecContext, value: DeleteRiteRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "repositoryId" -> Json.fromString(value.repositoryId),
        "id" -> Json.fromString(value.id),
        "expectedRevision" -> Json.fromInt(value.expectedRevision)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, DeleteRiteRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            repositoryId <- getField(jsonObject, "repositoryId").flatMap(v => decodeString(v.hcursor))
            id <- getField(jsonObject, "id").flatMap(v => decodeString(v.hcursor))
            expectedRevision <- getField(jsonObject, "expectedRevision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield DeleteRiteRequest(repositoryId,id,expectedRevision)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to DeleteRiteRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = DeleteRiteRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = DeleteRiteRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = DeleteRiteRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[DeleteRiteRequest]] = Lazy(DeleteRiteRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[DeleteRiteRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[DeleteRiteRequest] = LazyInstance.value
  }
}