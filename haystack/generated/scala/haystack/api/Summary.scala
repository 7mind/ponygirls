import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class Summary(
    key: String,
    project: String,
    item: String,
    revision: Int,
    title: String,
    docType: String,
    status: String,
    importance: String,
    humanAttention: String,
    tags: List[String],
    modifiedAt: String,
    modifiedBy: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Summary.baboonDomainVersion
    override def baboonDomainIdentifier: String = Summary.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Summary.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Summary.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Summary.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Summary.baboonMinReaderVersions
  }
  
  object Summary {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#Summary"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Summary] = Summary_JsonCodec.instance
  }
  
  object Summary_JsonCodec extends BaboonJsonCodec.BaseGenerated[Summary, BaboonJsonCodec[Summary]] {
    def encode(ctx: BaboonCodecContext, value: Summary): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "key" -> Json.fromString(value.key),
        "project" -> Json.fromString(value.project),
        "item" -> Json.fromString(value.item),
        "revision" -> Json.fromInt(value.revision),
        "title" -> Json.fromString(value.title),
        "docType" -> Json.fromString(value.docType),
        "status" -> Json.fromString(value.status),
        "importance" -> Json.fromString(value.importance),
        "humanAttention" -> Json.fromString(value.humanAttention),
        "tags" -> Json.fromValues(value.tags.map(e => Json.fromString(e))),
        "modifiedAt" -> Json.fromString(value.modifiedAt),
        "modifiedBy" -> Json.fromString(value.modifiedBy)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Summary] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            key <- getField(jsonObject, "key").flatMap(v => decodeString(v.hcursor))
            project <- getField(jsonObject, "project").flatMap(v => decodeString(v.hcursor))
            item <- getField(jsonObject, "item").flatMap(v => decodeString(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            title <- getField(jsonObject, "title").flatMap(v => decodeString(v.hcursor))
            docType <- getField(jsonObject, "docType").flatMap(v => decodeString(v.hcursor))
            status <- getField(jsonObject, "status").flatMap(v => decodeString(v.hcursor))
            importance <- getField(jsonObject, "importance").flatMap(v => decodeString(v.hcursor))
            humanAttention <- getField(jsonObject, "humanAttention").flatMap(v => decodeString(v.hcursor))
            tags <- getField(jsonObject, "tags").flatMap(v => decodeList(decodeString)(v.hcursor))
            modifiedAt <- getField(jsonObject, "modifiedAt").flatMap(v => decodeString(v.hcursor))
            modifiedBy <- getField(jsonObject, "modifiedBy").flatMap(v => decodeString(v.hcursor))
          } yield Summary(key,project,item,revision,title,docType,status,importance,humanAttention,tags,modifiedAt,modifiedBy)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Summary: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Summary.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Summary.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Summary.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Summary]] = Lazy(Summary_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Summary]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Summary] = LazyInstance.value
  }
}