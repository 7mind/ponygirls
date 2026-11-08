import io.circe.Decoder.decodeBoolean
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class StatusInfo(
    queuedRuns: Long,
    activeRuns: Long,
    schedulerEnabled: Boolean
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = StatusInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = StatusInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = StatusInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = StatusInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = StatusInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = StatusInfo.baboonMinReaderVersions
  }
  
  object StatusInfo {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#StatusInfo"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[StatusInfo] = StatusInfo_JsonCodec.instance
  }
  
  object StatusInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[StatusInfo, BaboonJsonCodec[StatusInfo]] {
    def encode(ctx: BaboonCodecContext, value: StatusInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "queuedRuns" -> Json.fromString(value.queuedRuns.toString),
        "activeRuns" -> Json.fromString(value.activeRuns.toString),
        "schedulerEnabled" -> Json.fromBoolean(value.schedulerEnabled)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, StatusInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            queuedRuns <- getField(jsonObject, "queuedRuns").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            activeRuns <- getField(jsonObject, "activeRuns").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            schedulerEnabled <- getField(jsonObject, "schedulerEnabled").flatMap(v => decodeBoolean(v.hcursor))
          } yield StatusInfo(queuedRuns,activeRuns,schedulerEnabled)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to StatusInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = StatusInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = StatusInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = StatusInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[StatusInfo]] = Lazy(StatusInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[StatusInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[StatusInfo] = LazyInstance.value
  }
}