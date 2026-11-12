import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class QueryLimitsResult(
    maxPageRecords: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = QueryLimitsResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = QueryLimitsResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = QueryLimitsResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = QueryLimitsResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = QueryLimitsResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = QueryLimitsResult.baboonMinReaderVersions
  }
  
  object QueryLimitsResult {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#QueryLimitsResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[QueryLimitsResult] = QueryLimitsResult_JsonCodec.instance
  }
  
  object QueryLimitsResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[QueryLimitsResult, BaboonJsonCodec[QueryLimitsResult]] {
    def encode(ctx: BaboonCodecContext, value: QueryLimitsResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "maxPageRecords" -> Json.fromInt(value.maxPageRecords)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, QueryLimitsResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            maxPageRecords <- getField(jsonObject, "maxPageRecords").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield QueryLimitsResult(maxPageRecords)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to QueryLimitsResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = QueryLimitsResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = QueryLimitsResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = QueryLimitsResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[QueryLimitsResult]] = Lazy(QueryLimitsResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[QueryLimitsResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[QueryLimitsResult] = LazyInstance.value
  }
}