import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class QueryRequest(
    query: String,
    caret: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = QueryRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = QueryRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = QueryRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = QueryRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = QueryRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = QueryRequest.baboonMinReaderVersions
  }
  
  object QueryRequest {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#QueryRequest"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[QueryRequest] = QueryRequest_JsonCodec.instance
  }
  
  object QueryRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[QueryRequest, BaboonJsonCodec[QueryRequest]] {
    def encode(ctx: BaboonCodecContext, value: QueryRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "query" -> Json.fromString(value.query),
        "caret" -> Json.fromInt(value.caret)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, QueryRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            query <- getField(jsonObject, "query").flatMap(v => decodeString(v.hcursor))
            caret <- getField(jsonObject, "caret").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield QueryRequest(query,caret)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to QueryRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = QueryRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = QueryRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = QueryRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[QueryRequest]] = Lazy(QueryRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[QueryRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[QueryRequest] = LazyInstance.value
  }
}