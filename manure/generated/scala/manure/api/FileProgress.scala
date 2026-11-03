import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class FileProgress(
    path: String,
    size: Long,
    receivedBytes: Long,
    receivedRanges: List[ByteRange]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = FileProgress.baboonDomainVersion
    override def baboonDomainIdentifier: String = FileProgress.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = FileProgress.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = FileProgress.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = FileProgress.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = FileProgress.baboonMinReaderVersions
  }
  
  object FileProgress {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#FileProgress"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[FileProgress] = FileProgress_JsonCodec.instance
  }
  
  object FileProgress_JsonCodec extends BaboonJsonCodec.BaseGenerated[FileProgress, BaboonJsonCodec[FileProgress]] {
    def encode(ctx: BaboonCodecContext, value: FileProgress): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "path" -> Json.fromString(value.path),
        "size" -> Json.fromString(value.size.toString),
        "receivedBytes" -> Json.fromString(value.receivedBytes.toString),
        "receivedRanges" -> Json.fromValues(value.receivedRanges.map(e => ByteRange_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, FileProgress] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            path <- getField(jsonObject, "path").flatMap(v => decodeString(v.hcursor))
            size <- getField(jsonObject, "size").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            receivedBytes <- getField(jsonObject, "receivedBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            receivedRanges <- getField(jsonObject, "receivedRanges").flatMap(v => decodeList(ByteRange_JsonCodec.circeDecoder)(v.hcursor))
          } yield FileProgress(path,size,receivedBytes,receivedRanges)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to FileProgress: object expected"))
      }
    }
  
    def baboonDomainVersion: String = FileProgress.baboonDomainVersion
    
    def baboonDomainIdentifier: String = FileProgress.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = FileProgress.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[FileProgress]] = Lazy(FileProgress_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[FileProgress]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[FileProgress] = LazyInstance.value
  }
}