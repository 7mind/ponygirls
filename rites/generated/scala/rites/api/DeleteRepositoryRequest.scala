import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class DeleteRepositoryRequest(
    id: String,
    expectedRevision: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = DeleteRepositoryRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = DeleteRepositoryRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = DeleteRepositoryRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = DeleteRepositoryRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = DeleteRepositoryRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = DeleteRepositoryRequest.baboonMinReaderVersions
  }
  
  object DeleteRepositoryRequest {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#DeleteRepositoryRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[DeleteRepositoryRequest] = DeleteRepositoryRequest_JsonCodec.instance
  }
  
  object DeleteRepositoryRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[DeleteRepositoryRequest, BaboonJsonCodec[DeleteRepositoryRequest]] {
    def encode(ctx: BaboonCodecContext, value: DeleteRepositoryRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id),
        "expectedRevision" -> Json.fromInt(value.expectedRevision)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, DeleteRepositoryRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeString(v.hcursor))
            expectedRevision <- getField(jsonObject, "expectedRevision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield DeleteRepositoryRequest(id,expectedRevision)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to DeleteRepositoryRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = DeleteRepositoryRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = DeleteRepositoryRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = DeleteRepositoryRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[DeleteRepositoryRequest]] = Lazy(DeleteRepositoryRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[DeleteRepositoryRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[DeleteRepositoryRequest] = LazyInstance.value
  }
}