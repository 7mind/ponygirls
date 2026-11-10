import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ReadResult(
    generation: Long,
    records: List[GraphRecord],
    cursor: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ReadResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ReadResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ReadResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ReadResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ReadResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ReadResult.baboonMinReaderVersions
  }
  
  object ReadResult {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ReadResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ReadResult] = ReadResult_JsonCodec.instance
  }
  
  object ReadResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ReadResult, BaboonJsonCodec[ReadResult]] {
    def encode(ctx: BaboonCodecContext, value: ReadResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "generation" -> Json.fromString(value.generation.toString),
        "records" -> Json.fromValues(value.records.map(e => GraphRecord_JsonCodec.instance.encode(ctx, e))),
        "cursor" -> value.cursor.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ReadResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            records <- getField(jsonObject, "records").flatMap(v => decodeList(GraphRecord_JsonCodec.circeDecoder)(v.hcursor))
            cursor <- getField(jsonObject, "cursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield ReadResult(generation,records,cursor)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ReadResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ReadResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ReadResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ReadResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ReadResult]] = Lazy(ReadResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ReadResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ReadResult] = LazyInstance.value
  }
}