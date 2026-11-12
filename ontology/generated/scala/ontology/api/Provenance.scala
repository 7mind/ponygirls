import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class Provenance(
    contributor: Actor,
    recorder: Actor,
    input: UUID,
    recordedAt: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Provenance.baboonDomainVersion
    override def baboonDomainIdentifier: String = Provenance.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Provenance.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Provenance.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Provenance.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Provenance.baboonMinReaderVersions
  }
  
  object Provenance {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Provenance"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Provenance] = Provenance_JsonCodec.instance
  }
  
  object Provenance_JsonCodec extends BaboonJsonCodec.BaseGenerated[Provenance, BaboonJsonCodec[Provenance]] {
    def encode(ctx: BaboonCodecContext, value: Provenance): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "contributor" -> Actor_JsonCodec.instance.encode(ctx, value.contributor),
        "recorder" -> Actor_JsonCodec.instance.encode(ctx, value.recorder),
        "input" -> Json.fromString(value.input.toString()),
        "recordedAt" -> Json.fromString(value.recordedAt)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Provenance] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            contributor <- getField(jsonObject, "contributor").flatMap(v => Actor_JsonCodec.circeDecoder(v.hcursor))
            recorder <- getField(jsonObject, "recorder").flatMap(v => Actor_JsonCodec.circeDecoder(v.hcursor))
            input <- getField(jsonObject, "input").flatMap(v => decodeUUID(v.hcursor))
            recordedAt <- getField(jsonObject, "recordedAt").flatMap(v => decodeString(v.hcursor))
          } yield Provenance(contributor,recorder,input,recordedAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Provenance: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Provenance.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Provenance.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Provenance.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Provenance]] = Lazy(Provenance_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Provenance]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Provenance] = LazyInstance.value
  }
}