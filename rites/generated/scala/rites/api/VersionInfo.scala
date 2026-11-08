import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class VersionInfo(
    current: String,
    minimum: String,
    supported: List[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = VersionInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = VersionInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = VersionInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = VersionInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = VersionInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = VersionInfo.baboonMinReaderVersions
  }
  
  object VersionInfo {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#VersionInfo"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[VersionInfo] = VersionInfo_JsonCodec.instance
  }
  
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