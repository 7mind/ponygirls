import io.circe.Decoder.{decodeBoolean, decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class ArchiveResult(
    rows: List[ArchiveRow],
    total: Long,
    nextCursor: Option[String],
    textScope: ArchiveTextScope,
    annChunkLimitPerOperand: Option[Int],
    relevanceOrdered: Boolean
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ArchiveResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ArchiveResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ArchiveResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ArchiveResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ArchiveResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ArchiveResult.baboonMinReaderVersions
  }
  
  object ArchiveResult {
    def baboonDomainVersion: String = "1.8.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ArchiveResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.8.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.8.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.7.0", "prefix-compact" -> "1.7.0", "prefix-any-mode" -> "1.7.0", "identical" -> "1.8.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ArchiveResult] = ArchiveResult_JsonCodec.instance
  }
  
  object ArchiveResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ArchiveResult, BaboonJsonCodec[ArchiveResult]] {
    def encode(ctx: BaboonCodecContext, value: ArchiveResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "rows" -> Json.fromValues(value.rows.map(e => ArchiveRow_JsonCodec.instance.encode(ctx, e))),
        "total" -> Json.fromString(value.total.toString),
        "nextCursor" -> value.nextCursor.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "textScope" -> ArchiveTextScope_JsonCodec.instance.encode(ctx, value.textScope),
        "annChunkLimitPerOperand" -> value.annChunkLimitPerOperand.map(v => Json.fromInt(v)).getOrElse(Json.Null),
        "relevanceOrdered" -> Json.fromBoolean(value.relevanceOrdered)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ArchiveResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            rows <- getField(jsonObject, "rows").flatMap(v => decodeList(ArchiveRow_JsonCodec.circeDecoder)(v.hcursor))
            total <- getField(jsonObject, "total").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            nextCursor <- getField(jsonObject, "nextCursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
            textScope <- getField(jsonObject, "textScope").flatMap(v => ArchiveTextScope_JsonCodec.circeDecoder(v.hcursor))
            annChunkLimitPerOperand <- getField(jsonObject, "annChunkLimitPerOperand").flatMap(v => decodeOption(BaboonJsonCodec.decodeInt)(v.hcursor))
            relevanceOrdered <- getField(jsonObject, "relevanceOrdered").flatMap(v => decodeBoolean(v.hcursor))
          } yield ArchiveResult(rows,total,nextCursor,textScope,annChunkLimitPerOperand,relevanceOrdered)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ArchiveResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ArchiveResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ArchiveResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ArchiveResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ArchiveResult]] = Lazy(ArchiveResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ArchiveResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ArchiveResult] = LazyInstance.value
  }
}