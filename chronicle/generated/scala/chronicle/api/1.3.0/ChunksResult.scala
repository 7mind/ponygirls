import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_3_0 {
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.5.0")
  final case class ChunksResult(
    chunks: List[Chunk],
    total: Int,
    offset: Int,
    view: ContentView
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = ChunksResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ChunksResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ChunksResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ChunksResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ChunksResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ChunksResult.baboonMinReaderVersions
  }
  
  object ChunksResult {
    def baboonDomainVersion: String = "1.3.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ChunksResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical", "1.4.0" -> "identical", "1.5.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[ChunksResult] = ChunksResult_JsonCodec.instance
  }
  
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.5.0")
  object ChunksResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ChunksResult, BaboonJsonCodec[ChunksResult]] {
    def encode(ctx: BaboonCodecContext, value: ChunksResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "chunks" -> Json.fromValues(value.chunks.map(e => Chunk_JsonCodec.instance.encode(ctx, e))),
        "total" -> Json.fromInt(value.total),
        "offset" -> Json.fromInt(value.offset),
        "view" -> ContentView_JsonCodec.instance.encode(ctx, value.view)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ChunksResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            chunks <- getField(jsonObject, "chunks").flatMap(v => decodeList(Chunk_JsonCodec.circeDecoder)(v.hcursor))
            total <- getField(jsonObject, "total").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            offset <- getField(jsonObject, "offset").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            view <- getField(jsonObject, "view").flatMap(v => ContentView_JsonCodec.circeDecoder(v.hcursor))
          } yield ChunksResult(chunks,total,offset,view)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ChunksResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ChunksResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ChunksResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ChunksResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ChunksResult]] = Lazy(ChunksResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ChunksResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ChunksResult] = LazyInstance.value
  }
}