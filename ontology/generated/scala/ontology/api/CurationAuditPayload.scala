import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CurationAuditPayload(
    encoding: String,
    content: String,
    digest: String,
    bytes: Long
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CurationAuditPayload.baboonDomainVersion
    override def baboonDomainIdentifier: String = CurationAuditPayload.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CurationAuditPayload.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CurationAuditPayload.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CurationAuditPayload.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CurationAuditPayload.baboonMinReaderVersions
  }
  
  object CurationAuditPayload {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CurationAuditPayload"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CurationAuditPayload] = CurationAuditPayload_JsonCodec.instance
  }
  
  object CurationAuditPayload_JsonCodec extends BaboonJsonCodec.BaseGenerated[CurationAuditPayload, BaboonJsonCodec[CurationAuditPayload]] {
    def encode(ctx: BaboonCodecContext, value: CurationAuditPayload): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "encoding" -> Json.fromString(value.encoding),
        "content" -> Json.fromString(value.content),
        "digest" -> Json.fromString(value.digest),
        "bytes" -> Json.fromString(value.bytes.toString)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationAuditPayload] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            encoding <- getField(jsonObject, "encoding").flatMap(v => decodeString(v.hcursor))
            content <- getField(jsonObject, "content").flatMap(v => decodeString(v.hcursor))
            digest <- getField(jsonObject, "digest").flatMap(v => decodeString(v.hcursor))
            bytes <- getField(jsonObject, "bytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
          } yield CurationAuditPayload(encoding,content,digest,bytes)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CurationAuditPayload: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CurationAuditPayload.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CurationAuditPayload.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CurationAuditPayload.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationAuditPayload]] = Lazy(CurationAuditPayload_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationAuditPayload]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationAuditPayload] = LazyInstance.value
  }
}