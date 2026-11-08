import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class SetGrantRequest(
    repositoryId: String,
    userId: String,
    role: Option[GrantRole],
    expectedRevision: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SetGrantRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = SetGrantRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SetGrantRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SetGrantRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SetGrantRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SetGrantRequest.baboonMinReaderVersions
  }
  
  object SetGrantRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#SetGrantRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SetGrantRequest] = SetGrantRequest_JsonCodec.instance
  }
  
  object SetGrantRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[SetGrantRequest, BaboonJsonCodec[SetGrantRequest]] {
    def encode(ctx: BaboonCodecContext, value: SetGrantRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "repositoryId" -> Json.fromString(value.repositoryId),
        "userId" -> Json.fromString(value.userId),
        "role" -> value.role.map(v => GrantRole_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "expectedRevision" -> Json.fromInt(value.expectedRevision)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SetGrantRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            repositoryId <- getField(jsonObject, "repositoryId").flatMap(v => decodeString(v.hcursor))
            userId <- getField(jsonObject, "userId").flatMap(v => decodeString(v.hcursor))
            role <- getField(jsonObject, "role").flatMap(v => decodeOption(GrantRole_JsonCodec.circeDecoder)(v.hcursor))
            expectedRevision <- getField(jsonObject, "expectedRevision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield SetGrantRequest(repositoryId,userId,role,expectedRevision)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SetGrantRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SetGrantRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SetGrantRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SetGrantRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SetGrantRequest]] = Lazy(SetGrantRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SetGrantRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SetGrantRequest] = LazyInstance.value
  }
}