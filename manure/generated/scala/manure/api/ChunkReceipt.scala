import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class ChunkReceipt(
    path: String,
    offset: Long,
    length: Int,
    receivedBytes: Long
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ChunkReceipt.baboonDomainVersion
    override def baboonDomainIdentifier: String = ChunkReceipt.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ChunkReceipt.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ChunkReceipt.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ChunkReceipt.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ChunkReceipt.baboonMinReaderVersions
  }
  
  object ChunkReceipt {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#ChunkReceipt"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ChunkReceipt] = ChunkReceipt_JsonCodec.instance
  }
  
  object ChunkReceipt_JsonCodec extends BaboonJsonCodec.BaseGenerated[ChunkReceipt, BaboonJsonCodec[ChunkReceipt]] {
    def encode(ctx: BaboonCodecContext, value: ChunkReceipt): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "path" -> Json.fromString(value.path),
        "offset" -> Json.fromString(value.offset.toString),
        "length" -> Json.fromInt(value.length),
        "receivedBytes" -> Json.fromString(value.receivedBytes.toString)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ChunkReceipt] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            path <- getField(jsonObject, "path").flatMap(v => decodeString(v.hcursor))
            offset <- getField(jsonObject, "offset").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            length <- getField(jsonObject, "length").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            receivedBytes <- getField(jsonObject, "receivedBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
          } yield ChunkReceipt(path,offset,length,receivedBytes)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ChunkReceipt: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ChunkReceipt.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ChunkReceipt.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ChunkReceipt.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ChunkReceipt]] = Lazy(ChunkReceipt_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ChunkReceipt]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ChunkReceipt] = LazyInstance.value
  }
}