import io.circe.Decoder.decodeUUID
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class Ref(
    id: UUID,
    revision: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Ref.baboonDomainVersion
    override def baboonDomainIdentifier: String = Ref.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Ref.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Ref.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Ref.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Ref.baboonMinReaderVersions
  }
  
  object Ref {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Ref"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Ref] = Ref_JsonCodec.instance
  }
  
  object Ref_JsonCodec extends BaboonJsonCodec.BaseGenerated[Ref, BaboonJsonCodec[Ref]] {
    def encode(ctx: BaboonCodecContext, value: Ref): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id.toString()),
        "revision" -> Json.fromInt(value.revision)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Ref] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeUUID(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield Ref(id,revision)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Ref: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Ref.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Ref.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Ref.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Ref]] = Lazy(Ref_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Ref]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Ref] = LazyInstance.value
  }
}