import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_1_0 {
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.4.0")
  final case class VersionInfo(
    current: String,
    minimum: String,
    supported: List[String]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = VersionInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = VersionInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = VersionInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = VersionInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = VersionInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = VersionInfo.baboonMinReaderVersions
  }
  
  object VersionInfo {
    def baboonDomainVersion: String = "1.1.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#VersionInfo"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical", "1.2.0" -> "identical", "1.3.0" -> "identical", "1.4.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[VersionInfo] = VersionInfo_JsonCodec.instance
  }
  
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.4.0")
  object VersionInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[VersionInfo, BaboonJsonCodec[VersionInfo]] {
    def encode(ctx: BaboonCodecContext, value: VersionInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "current" -> Json.fromString(value.current),
        "minimum" -> Json.fromString(value.minimum),
        "supported" -> Json.fromValues(value.supported.map(e => Json.fromString(e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, VersionInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            current <- getField(jsonObject, "current").flatMap(v => decodeString(v.hcursor))
            minimum <- getField(jsonObject, "minimum").flatMap(v => decodeString(v.hcursor))
            supported <- getField(jsonObject, "supported").flatMap(v => decodeList(decodeString)(v.hcursor))
          } yield VersionInfo(current,minimum,supported)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to VersionInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = VersionInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = VersionInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = VersionInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[VersionInfo]] = Lazy(VersionInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[VersionInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[VersionInfo] = LazyInstance.value
  }
}