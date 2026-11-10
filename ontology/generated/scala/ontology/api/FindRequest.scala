import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class FindRequest(
    scope: String,
    kind: Option[String],
    query: String,
    cursor: Option[String],
    limit: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = FindRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = FindRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = FindRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = FindRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = FindRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = FindRequest.baboonMinReaderVersions
  }
  
  object FindRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#FindRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[FindRequest] = FindRequest_JsonCodec.instance
  }
  
  object FindRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[FindRequest, BaboonJsonCodec[FindRequest]] {
    def encode(ctx: BaboonCodecContext, value: FindRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "kind" -> value.kind.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "query" -> Json.fromString(value.query),
        "cursor" -> value.cursor.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "limit" -> Json.fromInt(value.limit)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, FindRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            kind <- getField(jsonObject, "kind").flatMap(v => decodeOption(decodeString)(v.hcursor))
            query <- getField(jsonObject, "query").flatMap(v => decodeString(v.hcursor))
            cursor <- getField(jsonObject, "cursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
            limit <- getField(jsonObject, "limit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield FindRequest(scope,kind,query,cursor,limit)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to FindRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = FindRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = FindRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = FindRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[FindRequest]] = Lazy(FindRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[FindRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[FindRequest] = LazyInstance.value
  }
}