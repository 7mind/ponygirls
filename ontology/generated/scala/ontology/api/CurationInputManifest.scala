import io.circe.Decoder.{decodeList, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class CurationInputManifest(
    attemptId: UUID,
    seed: List[CurationRecordPin],
    sources: List[CurationSourcePin],
    encoding: String,
    inputDigest: String,
    inputBytes: Long,
    sealedAt: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CurationInputManifest.baboonDomainVersion
    override def baboonDomainIdentifier: String = CurationInputManifest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CurationInputManifest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CurationInputManifest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CurationInputManifest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CurationInputManifest.baboonMinReaderVersions
  }
  
  object CurationInputManifest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CurationInputManifest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CurationInputManifest] = CurationInputManifest_JsonCodec.instance
  }
  
  object CurationInputManifest_JsonCodec extends BaboonJsonCodec.BaseGenerated[CurationInputManifest, BaboonJsonCodec[CurationInputManifest]] {
    def encode(ctx: BaboonCodecContext, value: CurationInputManifest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "attemptId" -> Json.fromString(value.attemptId.toString()),
        "seed" -> Json.fromValues(value.seed.map(e => CurationRecordPin_JsonCodec.instance.encode(ctx, e))),
        "sources" -> Json.fromValues(value.sources.map(e => CurationSourcePin_JsonCodec.instance.encode(ctx, e))),
        "encoding" -> Json.fromString(value.encoding),
        "inputDigest" -> Json.fromString(value.inputDigest),
        "inputBytes" -> Json.fromString(value.inputBytes.toString),
        "sealedAt" -> Json.fromString(value.sealedAt)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationInputManifest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            attemptId <- getField(jsonObject, "attemptId").flatMap(v => decodeUUID(v.hcursor))
            seed <- getField(jsonObject, "seed").flatMap(v => decodeList(CurationRecordPin_JsonCodec.circeDecoder)(v.hcursor))
            sources <- getField(jsonObject, "sources").flatMap(v => decodeList(CurationSourcePin_JsonCodec.circeDecoder)(v.hcursor))
            encoding <- getField(jsonObject, "encoding").flatMap(v => decodeString(v.hcursor))
            inputDigest <- getField(jsonObject, "inputDigest").flatMap(v => decodeString(v.hcursor))
            inputBytes <- getField(jsonObject, "inputBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            sealedAt <- getField(jsonObject, "sealedAt").flatMap(v => decodeString(v.hcursor))
          } yield CurationInputManifest(attemptId,seed,sources,encoding,inputDigest,inputBytes,sealedAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CurationInputManifest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CurationInputManifest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CurationInputManifest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CurationInputManifest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationInputManifest]] = Lazy(CurationInputManifest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationInputManifest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationInputManifest] = LazyInstance.value
  }
}