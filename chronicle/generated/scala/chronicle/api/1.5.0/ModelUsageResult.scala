import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_5_0 {
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.8.0")
  final case class ModelUsageResult(
    observedAt: String,
    processStartedAt: String,
    windowStartAt: String,
    windowEndAt: String,
    coveredMillis: Int,
    basis: ModelRateBasis,
    settings: IndexingSettings,
    samples: List[ModelUsageSlice]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = ModelUsageResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ModelUsageResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ModelUsageResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ModelUsageResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ModelUsageResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ModelUsageResult.baboonMinReaderVersions
  }
  
  object ModelUsageResult {
    def baboonDomainVersion: String = "1.5.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ModelUsageResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical", "1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[ModelUsageResult] = ModelUsageResult_JsonCodec.instance
  }
  
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.8.0")
  object ModelUsageResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ModelUsageResult, BaboonJsonCodec[ModelUsageResult]] {
    def encode(ctx: BaboonCodecContext, value: ModelUsageResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "observedAt" -> Json.fromString(value.observedAt),
        "processStartedAt" -> Json.fromString(value.processStartedAt),
        "windowStartAt" -> Json.fromString(value.windowStartAt),
        "windowEndAt" -> Json.fromString(value.windowEndAt),
        "coveredMillis" -> Json.fromInt(value.coveredMillis),
        "basis" -> ModelRateBasis_JsonCodec.instance.encode(ctx, value.basis),
        "settings" -> IndexingSettings_JsonCodec.instance.encode(ctx, value.settings),
        "samples" -> Json.fromValues(value.samples.map(e => ModelUsageSlice_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ModelUsageResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            observedAt <- getField(jsonObject, "observedAt").flatMap(v => decodeString(v.hcursor))
            processStartedAt <- getField(jsonObject, "processStartedAt").flatMap(v => decodeString(v.hcursor))
            windowStartAt <- getField(jsonObject, "windowStartAt").flatMap(v => decodeString(v.hcursor))
            windowEndAt <- getField(jsonObject, "windowEndAt").flatMap(v => decodeString(v.hcursor))
            coveredMillis <- getField(jsonObject, "coveredMillis").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            basis <- getField(jsonObject, "basis").flatMap(v => ModelRateBasis_JsonCodec.circeDecoder(v.hcursor))
            settings <- getField(jsonObject, "settings").flatMap(v => IndexingSettings_JsonCodec.circeDecoder(v.hcursor))
            samples <- getField(jsonObject, "samples").flatMap(v => decodeList(ModelUsageSlice_JsonCodec.circeDecoder)(v.hcursor))
          } yield ModelUsageResult(observedAt,processStartedAt,windowStartAt,windowEndAt,coveredMillis,basis,settings,samples)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ModelUsageResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ModelUsageResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ModelUsageResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ModelUsageResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ModelUsageResult]] = Lazy(ModelUsageResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ModelUsageResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ModelUsageResult] = LazyInstance.value
  }
}