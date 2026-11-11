import io.circe.Decoder.{decodeBoolean, decodeList, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class ApplyResult(
    scope: String,
    requestId: UUID,
    generation: Long,
    created: List[AliasRef],
    replayed: Boolean
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ApplyResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ApplyResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ApplyResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ApplyResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ApplyResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ApplyResult.baboonMinReaderVersions
  }
  
  object ApplyResult {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ApplyResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ApplyResult] = ApplyResult_JsonCodec.instance
  }
  
  object ApplyResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ApplyResult, BaboonJsonCodec[ApplyResult]] {
    def encode(ctx: BaboonCodecContext, value: ApplyResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "requestId" -> Json.fromString(value.requestId.toString()),
        "generation" -> Json.fromString(value.generation.toString),
        "created" -> Json.fromValues(value.created.map(e => AliasRef_JsonCodec.instance.encode(ctx, e))),
        "replayed" -> Json.fromBoolean(value.replayed)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ApplyResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            requestId <- getField(jsonObject, "requestId").flatMap(v => decodeUUID(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            created <- getField(jsonObject, "created").flatMap(v => decodeList(AliasRef_JsonCodec.circeDecoder)(v.hcursor))
            replayed <- getField(jsonObject, "replayed").flatMap(v => decodeBoolean(v.hcursor))
          } yield ApplyResult(scope,requestId,generation,created,replayed)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ApplyResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ApplyResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ApplyResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ApplyResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ApplyResult]] = Lazy(ApplyResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ApplyResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ApplyResult] = LazyInstance.value
  }
}