import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class DocumentPayload(
    json: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = DocumentPayload.baboonDomainVersion
    override def baboonDomainIdentifier: String = DocumentPayload.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = DocumentPayload.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = DocumentPayload.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = DocumentPayload.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = DocumentPayload.baboonMinReaderVersions
  }
  
  object DocumentPayload {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#DocumentPayload"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[DocumentPayload] = DocumentPayload_JsonCodec.instance
  }
  
  object DocumentPayload_JsonCodec extends BaboonJsonCodec.BaseGenerated[DocumentPayload, BaboonJsonCodec[DocumentPayload]] {
    def encode(ctx: BaboonCodecContext, value: DocumentPayload): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "json" -> Json.fromString(value.json)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, DocumentPayload] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            json <- getField(jsonObject, "json").flatMap(v => decodeString(v.hcursor))
          } yield DocumentPayload(json)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to DocumentPayload: object expected"))
      }
    }
  
    def baboonDomainVersion: String = DocumentPayload.baboonDomainVersion
    
    def baboonDomainIdentifier: String = DocumentPayload.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = DocumentPayload.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[DocumentPayload]] = Lazy(DocumentPayload_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[DocumentPayload]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[DocumentPayload] = LazyInstance.value
  }
}