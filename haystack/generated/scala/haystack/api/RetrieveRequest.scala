import io.circe.Decoder.{decodeBoolean, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class RetrieveRequest(
    query: String,
    mode: RetrievalMode,
    project: Option[String],
    includeArchived: Boolean,
    offset: Int,
    limit: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RetrieveRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = RetrieveRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RetrieveRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RetrieveRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RetrieveRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RetrieveRequest.baboonMinReaderVersions
  }
  
  object RetrieveRequest {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#RetrieveRequest"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RetrieveRequest] = RetrieveRequest_JsonCodec.instance
  }
  
  object RetrieveRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[RetrieveRequest, BaboonJsonCodec[RetrieveRequest]] {
    def encode(ctx: BaboonCodecContext, value: RetrieveRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "query" -> Json.fromString(value.query),
        "mode" -> RetrievalMode_JsonCodec.instance.encode(ctx, value.mode),
        "project" -> value.project.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "includeArchived" -> Json.fromBoolean(value.includeArchived),
        "offset" -> Json.fromInt(value.offset),
        "limit" -> Json.fromInt(value.limit)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RetrieveRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            query <- getField(jsonObject, "query").flatMap(v => decodeString(v.hcursor))
            mode <- getField(jsonObject, "mode").flatMap(v => RetrievalMode_JsonCodec.circeDecoder(v.hcursor))
            project <- getField(jsonObject, "project").flatMap(v => decodeOption(decodeString)(v.hcursor))
            includeArchived <- getField(jsonObject, "includeArchived").flatMap(v => decodeBoolean(v.hcursor))
            offset <- getField(jsonObject, "offset").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            limit <- getField(jsonObject, "limit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield RetrieveRequest(query,mode,project,includeArchived,offset,limit)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RetrieveRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RetrieveRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RetrieveRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RetrieveRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RetrieveRequest]] = Lazy(RetrieveRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RetrieveRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RetrieveRequest] = LazyInstance.value
  }
}