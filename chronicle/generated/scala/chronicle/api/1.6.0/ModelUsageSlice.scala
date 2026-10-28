import io.circe.Decoder.decodeOption
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_6_0 {
  @deprecated("Version 1.6.0 is deprecated, you should migrate to 1.7.0")
  final case class ModelUsageSlice(
    purpose: ModelPurpose,
    inFlight: Int,
    finishedCalls: Long,
    failedCalls: Long,
    cancelledCalls: Long,
    invalidUsageCalls: Long,
    input: TokenRateWindow,
    output: Option[TokenRateWindow],
    reasoningSubset: Option[TokenRateWindow]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = ModelUsageSlice.baboonDomainVersion
    override def baboonDomainIdentifier: String = ModelUsageSlice.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ModelUsageSlice.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ModelUsageSlice.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ModelUsageSlice.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ModelUsageSlice.baboonMinReaderVersions
  }
  
  object ModelUsageSlice {
    def baboonDomainVersion: String = "1.6.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ModelUsageSlice"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.6.0" -> "identical", "1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[ModelUsageSlice] = ModelUsageSlice_JsonCodec.instance
  }
  
  @deprecated("Version 1.6.0 is deprecated, you should migrate to 1.7.0")
  object ModelUsageSlice_JsonCodec extends BaboonJsonCodec.BaseGenerated[ModelUsageSlice, BaboonJsonCodec[ModelUsageSlice]] {
    def encode(ctx: BaboonCodecContext, value: ModelUsageSlice): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "purpose" -> ModelPurpose_JsonCodec.instance.encode(ctx, value.purpose),
        "inFlight" -> Json.fromInt(value.inFlight),
        "finishedCalls" -> Json.fromString(value.finishedCalls.toString),
        "failedCalls" -> Json.fromString(value.failedCalls.toString),
        "cancelledCalls" -> Json.fromString(value.cancelledCalls.toString),
        "invalidUsageCalls" -> Json.fromString(value.invalidUsageCalls.toString),
        "input" -> TokenRateWindow_JsonCodec.instance.encode(ctx, value.input),
        "output" -> value.output.map(v => TokenRateWindow_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "reasoningSubset" -> value.reasoningSubset.map(v => TokenRateWindow_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ModelUsageSlice] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            purpose <- getField(jsonObject, "purpose").flatMap(v => ModelPurpose_JsonCodec.circeDecoder(v.hcursor))
            inFlight <- getField(jsonObject, "inFlight").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            finishedCalls <- getField(jsonObject, "finishedCalls").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            failedCalls <- getField(jsonObject, "failedCalls").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            cancelledCalls <- getField(jsonObject, "cancelledCalls").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            invalidUsageCalls <- getField(jsonObject, "invalidUsageCalls").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            input <- getField(jsonObject, "input").flatMap(v => TokenRateWindow_JsonCodec.circeDecoder(v.hcursor))
            output <- getField(jsonObject, "output").flatMap(v => decodeOption(TokenRateWindow_JsonCodec.circeDecoder)(v.hcursor))
            reasoningSubset <- getField(jsonObject, "reasoningSubset").flatMap(v => decodeOption(TokenRateWindow_JsonCodec.circeDecoder)(v.hcursor))
          } yield ModelUsageSlice(purpose,inFlight,finishedCalls,failedCalls,cancelledCalls,invalidUsageCalls,input,output,reasoningSubset)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ModelUsageSlice: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ModelUsageSlice.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ModelUsageSlice.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ModelUsageSlice.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ModelUsageSlice]] = Lazy(ModelUsageSlice_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ModelUsageSlice]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ModelUsageSlice] = LazyInstance.value
  }
}