import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class FindResult(
    scope: String,
    generation: Long,
    items: List[SearchHit],
    cursor: Option[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = FindResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = FindResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = FindResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = FindResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = FindResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = FindResult.baboonMinReaderVersions
  }
  
  object FindResult {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#FindResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[FindResult] = FindResult_JsonCodec.instance
  }
  
  object FindResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[FindResult, BaboonJsonCodec[FindResult]] {
    def encode(ctx: BaboonCodecContext, value: FindResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "generation" -> Json.fromString(value.generation.toString),
        "items" -> Json.fromValues(value.items.map(e => SearchHit_JsonCodec.instance.encode(ctx, e))),
        "cursor" -> value.cursor.map(v => Json.fromString(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, FindResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            items <- getField(jsonObject, "items").flatMap(v => decodeList(SearchHit_JsonCodec.circeDecoder)(v.hcursor))
            cursor <- getField(jsonObject, "cursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
          } yield FindResult(scope,generation,items,cursor)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to FindResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = FindResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = FindResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = FindResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[FindResult]] = Lazy(FindResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[FindResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[FindResult] = LazyInstance.value
  }
}