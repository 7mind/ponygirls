import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_0_0 {
  @deprecated("Version 1.0.0 is deprecated, you should migrate to 1.5.0")
  final case class StatusResult(
    jobs: List[JobInfo],
    total: Int
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = StatusResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = StatusResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = StatusResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = StatusResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = StatusResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = StatusResult.baboonMinReaderVersions
  }
  
  object StatusResult {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#StatusResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical", "1.1.0" -> "identical", "1.2.0" -> "json-additive", "1.3.0" -> "json-additive", "1.4.0" -> "json-additive", "1.5.0" -> "json-additive")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[StatusResult] = StatusResult_JsonCodec.instance
  }
  
  @deprecated("Version 1.0.0 is deprecated, you should migrate to 1.5.0")
  object StatusResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[StatusResult, BaboonJsonCodec[StatusResult]] {
    def encode(ctx: BaboonCodecContext, value: StatusResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "jobs" -> Json.fromValues(value.jobs.map(e => JobInfo_JsonCodec.instance.encode(ctx, e))),
        "total" -> Json.fromInt(value.total)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, StatusResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            jobs <- getField(jsonObject, "jobs").flatMap(v => decodeList(JobInfo_JsonCodec.circeDecoder)(v.hcursor))
            total <- getField(jsonObject, "total").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield StatusResult(jobs,total)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to StatusResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = StatusResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = StatusResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = StatusResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[StatusResult]] = Lazy(StatusResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[StatusResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[StatusResult] = LazyInstance.value
  }
}