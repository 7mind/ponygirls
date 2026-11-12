import io.circe.Decoder.{decodeList, decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class CapsulePayload(
    scope: String,
    workContext: String,
    reportedContext: ContextRecord,
    cut: CapsuleCut,
    previousCapsuleId: Option[UUID],
    policy: CapsulePolicyIdentity,
    records: List[GraphRecord],
    manifest: CapsuleManifest,
    text: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CapsulePayload.baboonDomainVersion
    override def baboonDomainIdentifier: String = CapsulePayload.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CapsulePayload.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CapsulePayload.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CapsulePayload.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CapsulePayload.baboonMinReaderVersions
  }
  
  object CapsulePayload {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CapsulePayload"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CapsulePayload] = CapsulePayload_JsonCodec.instance
  }
  
  object CapsulePayload_JsonCodec extends BaboonJsonCodec.BaseGenerated[CapsulePayload, BaboonJsonCodec[CapsulePayload]] {
    def encode(ctx: BaboonCodecContext, value: CapsulePayload): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "workContext" -> Json.fromString(value.workContext),
        "reportedContext" -> ContextRecord_JsonCodec.instance.encode(ctx, value.reportedContext),
        "cut" -> CapsuleCut_JsonCodec.instance.encode(ctx, value.cut),
        "previousCapsuleId" -> value.previousCapsuleId.map(v => Json.fromString(v.toString())).getOrElse(Json.Null),
        "policy" -> CapsulePolicyIdentity_JsonCodec.instance.encode(ctx, value.policy),
        "records" -> Json.fromValues(value.records.map(e => GraphRecord_JsonCodec.instance.encode(ctx, e))),
        "manifest" -> CapsuleManifest_JsonCodec.instance.encode(ctx, value.manifest),
        "text" -> Json.fromString(value.text)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CapsulePayload] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            workContext <- getField(jsonObject, "workContext").flatMap(v => decodeString(v.hcursor))
            reportedContext <- getField(jsonObject, "reportedContext").flatMap(v => ContextRecord_JsonCodec.circeDecoder(v.hcursor))
            cut <- getField(jsonObject, "cut").flatMap(v => CapsuleCut_JsonCodec.circeDecoder(v.hcursor))
            previousCapsuleId <- getField(jsonObject, "previousCapsuleId").flatMap(v => decodeOption(decodeUUID)(v.hcursor))
            policy <- getField(jsonObject, "policy").flatMap(v => CapsulePolicyIdentity_JsonCodec.circeDecoder(v.hcursor))
            records <- getField(jsonObject, "records").flatMap(v => decodeList(GraphRecord_JsonCodec.circeDecoder)(v.hcursor))
            manifest <- getField(jsonObject, "manifest").flatMap(v => CapsuleManifest_JsonCodec.circeDecoder(v.hcursor))
            text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
          } yield CapsulePayload(scope,workContext,reportedContext,cut,previousCapsuleId,policy,records,manifest,text)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CapsulePayload: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CapsulePayload.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CapsulePayload.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CapsulePayload.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CapsulePayload]] = Lazy(CapsulePayload_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CapsulePayload]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CapsulePayload] = LazyInstance.value
  }
}