import io.circe.Decoder.{decodeList, decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class CaptureMetadata(
    sourceId: String,
    parentSourceId: Option[String],
    observedAt: Option[String],
    representation: SourceRepresentation,
    omissions: List[String],
    exposedDeliveries: List[UUID]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CaptureMetadata.baboonDomainVersion
    override def baboonDomainIdentifier: String = CaptureMetadata.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CaptureMetadata.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CaptureMetadata.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CaptureMetadata.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CaptureMetadata.baboonMinReaderVersions
  }
  
  object CaptureMetadata {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CaptureMetadata"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CaptureMetadata] = CaptureMetadata_JsonCodec.instance
  }
  
  object CaptureMetadata_JsonCodec extends BaboonJsonCodec.BaseGenerated[CaptureMetadata, BaboonJsonCodec[CaptureMetadata]] {
    def encode(ctx: BaboonCodecContext, value: CaptureMetadata): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "sourceId" -> Json.fromString(value.sourceId),
        "parentSourceId" -> value.parentSourceId.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "observedAt" -> value.observedAt.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "representation" -> SourceRepresentation_JsonCodec.instance.encode(ctx, value.representation),
        "omissions" -> Json.fromValues(value.omissions.map(e => Json.fromString(e))),
        "exposedDeliveries" -> Json.fromValues(value.exposedDeliveries.map(e => Json.fromString(e.toString())))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CaptureMetadata] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            sourceId <- getField(jsonObject, "sourceId").flatMap(v => decodeString(v.hcursor))
            parentSourceId <- getField(jsonObject, "parentSourceId").flatMap(v => decodeOption(decodeString)(v.hcursor))
            observedAt <- getField(jsonObject, "observedAt").flatMap(v => decodeOption(decodeString)(v.hcursor))
            representation <- getField(jsonObject, "representation").flatMap(v => SourceRepresentation_JsonCodec.circeDecoder(v.hcursor))
            omissions <- getField(jsonObject, "omissions").flatMap(v => decodeList(decodeString)(v.hcursor))
            exposedDeliveries <- getField(jsonObject, "exposedDeliveries").flatMap(v => decodeList(decodeUUID)(v.hcursor))
          } yield CaptureMetadata(sourceId,parentSourceId,observedAt,representation,omissions,exposedDeliveries)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CaptureMetadata: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CaptureMetadata.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CaptureMetadata.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CaptureMetadata.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CaptureMetadata]] = Lazy(CaptureMetadata_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CaptureMetadata]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CaptureMetadata] = LazyInstance.value
  }
}