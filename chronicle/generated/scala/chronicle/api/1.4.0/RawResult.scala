import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_4_0 {
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.7.0")
  final case class RawResult(
    files: List[RawFile],
    revision: Int
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = RawResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = RawResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RawResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RawResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RawResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RawResult.baboonMinReaderVersions
  }
  
  object RawResult {
    def baboonDomainVersion: String = "1.4.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#RawResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.4.0" -> "identical", "1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[RawResult] = RawResult_JsonCodec.instance
  }
  
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.7.0")
  object RawResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[RawResult, BaboonJsonCodec[RawResult]] {
    def encode(ctx: BaboonCodecContext, value: RawResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "files" -> Json.fromValues(value.files.map(e => RawFile_JsonCodec.instance.encode(ctx, e))),
        "revision" -> Json.fromInt(value.revision)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RawResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            files <- getField(jsonObject, "files").flatMap(v => decodeList(RawFile_JsonCodec.circeDecoder)(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield RawResult(files,revision)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RawResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RawResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RawResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RawResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RawResult]] = Lazy(RawResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RawResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RawResult] = LazyInstance.value
  }
}