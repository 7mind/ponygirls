import io.circe.Decoder.{decodeList, decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class ApplyRequest(
    scope: String,
    requestId: UUID,
    expectedGeneration: Long,
    operations: List[Operation],
    contributionContext: Option[ContextRecordInput]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ApplyRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = ApplyRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ApplyRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ApplyRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ApplyRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ApplyRequest.baboonMinReaderVersions
  }
  
  object ApplyRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ApplyRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ApplyRequest] = ApplyRequest_JsonCodec.instance
  }
  
  object ApplyRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[ApplyRequest, BaboonJsonCodec[ApplyRequest]] {
    def encode(ctx: BaboonCodecContext, value: ApplyRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "requestId" -> Json.fromString(value.requestId.toString()),
        "expectedGeneration" -> Json.fromString(value.expectedGeneration.toString),
        "operations" -> Json.fromValues(value.operations.map(e => Operation_JsonCodec.instance.encode(ctx, e))),
        "contributionContext" -> value.contributionContext.map(v => ContextRecordInput_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ApplyRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            expectedGeneration <- getField(jsonObject, "expectedGeneration").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            operations <- getField(jsonObject, "operations").flatMap(v => decodeList(Operation_JsonCodec.circeDecoder)(v.hcursor))
            contributionContext <- getField(jsonObject, "contributionContext").flatMap(v => decodeOption(ContextRecordInput_JsonCodec.circeDecoder)(v.hcursor))
          } yield ApplyRequest(scope,requestId,expectedGeneration,operations,contributionContext)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ApplyRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ApplyRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ApplyRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ApplyRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ApplyRequest]] = Lazy(ApplyRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ApplyRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ApplyRequest] = LazyInstance.value
  }
}