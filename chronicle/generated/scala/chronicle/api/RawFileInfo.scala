import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class RawFileInfo(
    index: Int,
    path: String,
    sha256: String,
    bytes: Long
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RawFileInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = RawFileInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RawFileInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RawFileInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RawFileInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RawFileInfo.baboonMinReaderVersions
  }
  
  object RawFileInfo {
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#RawFileInfo"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RawFileInfo] = RawFileInfo_JsonCodec.instance
  }
  
  object RawFileInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[RawFileInfo, BaboonJsonCodec[RawFileInfo]] {
    def encode(ctx: BaboonCodecContext, value: RawFileInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "index" -> Json.fromInt(value.index),
        "path" -> Json.fromString(value.path),
        "sha256" -> Json.fromString(value.sha256),
        "bytes" -> Json.fromString(value.bytes.toString)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RawFileInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            index <- getField(jsonObject, "index").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            path <- getField(jsonObject, "path").flatMap(v => decodeString(v.hcursor))
            sha256 <- getField(jsonObject, "sha256").flatMap(v => decodeString(v.hcursor))
            bytes <- getField(jsonObject, "bytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
          } yield RawFileInfo(index,path,sha256,bytes)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RawFileInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RawFileInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RawFileInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RawFileInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RawFileInfo]] = Lazy(RawFileInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RawFileInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RawFileInfo] = LazyInstance.value
  }
}