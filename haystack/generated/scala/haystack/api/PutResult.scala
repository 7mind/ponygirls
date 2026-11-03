import io.circe.Decoder.{decodeBoolean, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class PutResult(
    key: String,
    revision: Int,
    metadata: Metadata,
    replayed: Boolean
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = PutResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = PutResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = PutResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = PutResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = PutResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = PutResult.baboonMinReaderVersions
  }
  
  object PutResult {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#PutResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[PutResult] = PutResult_JsonCodec.instance
  }
  
  object PutResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[PutResult, BaboonJsonCodec[PutResult]] {
    def encode(ctx: BaboonCodecContext, value: PutResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "key" -> Json.fromString(value.key),
        "revision" -> Json.fromInt(value.revision),
        "metadata" -> Metadata_JsonCodec.instance.encode(ctx, value.metadata),
        "replayed" -> Json.fromBoolean(value.replayed)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PutResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            key <- getField(jsonObject, "key").flatMap(v => decodeString(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            metadata <- getField(jsonObject, "metadata").flatMap(v => Metadata_JsonCodec.circeDecoder(v.hcursor))
            replayed <- getField(jsonObject, "replayed").flatMap(v => decodeBoolean(v.hcursor))
          } yield PutResult(key,revision,metadata,replayed)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to PutResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = PutResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = PutResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = PutResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PutResult]] = Lazy(PutResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PutResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PutResult] = LazyInstance.value
  }
}