import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ReadRequest(
    scope: String,
    view: ReadView,
    targets: List[Ref],
    cursor: Option[String],
    limit: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ReadRequest.baboonDomainVersion
    override def baboonDomainIdentifier: String = ReadRequest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ReadRequest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ReadRequest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ReadRequest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ReadRequest.baboonMinReaderVersions
  }
  
  object ReadRequest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ReadRequest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ReadRequest] = ReadRequest_JsonCodec.instance
  }
  
  object ReadRequest_JsonCodec extends BaboonJsonCodec.BaseGenerated[ReadRequest, BaboonJsonCodec[ReadRequest]] {
    def encode(ctx: BaboonCodecContext, value: ReadRequest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "view" -> ReadView_JsonCodec.instance.encode(ctx, value.view),
        "targets" -> Json.fromValues(value.targets.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "cursor" -> value.cursor.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "limit" -> Json.fromInt(value.limit)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ReadRequest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            view <- getField(jsonObject, "view").flatMap(v => ReadView_JsonCodec.circeDecoder(v.hcursor))
            targets <- getField(jsonObject, "targets").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            cursor <- getField(jsonObject, "cursor").flatMap(v => decodeOption(decodeString)(v.hcursor))
            limit <- getField(jsonObject, "limit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield ReadRequest(scope,view,targets,cursor,limit)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ReadRequest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ReadRequest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ReadRequest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ReadRequest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ReadRequest]] = Lazy(ReadRequest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ReadRequest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ReadRequest] = LazyInstance.value
  }
}