import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_1_0 {
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.3.0")
  final case class RawFile(
    path: String,
    sha256: String,
    content: String
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = RawFile.baboonDomainVersion
    override def baboonDomainIdentifier: String = RawFile.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RawFile.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RawFile.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RawFile.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RawFile.baboonMinReaderVersions
  }
  
  object RawFile {
    def baboonDomainVersion: String = "1.1.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#RawFile"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.1.0" -> "identical", "1.2.0" -> "identical", "1.3.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[RawFile] = RawFile_JsonCodec.instance
  }
  
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.3.0")
  object RawFile_JsonCodec extends BaboonJsonCodec.BaseGenerated[RawFile, BaboonJsonCodec[RawFile]] {
    def encode(ctx: BaboonCodecContext, value: RawFile): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "path" -> Json.fromString(value.path),
        "sha256" -> Json.fromString(value.sha256),
        "content" -> Json.fromString(value.content)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RawFile] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            path <- getField(jsonObject, "path").flatMap(v => decodeString(v.hcursor))
            sha256 <- getField(jsonObject, "sha256").flatMap(v => decodeString(v.hcursor))
            content <- getField(jsonObject, "content").flatMap(v => decodeString(v.hcursor))
          } yield RawFile(path,sha256,content)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RawFile: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RawFile.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RawFile.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RawFile.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RawFile]] = Lazy(RawFile_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RawFile]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RawFile] = LazyInstance.value
  }
}