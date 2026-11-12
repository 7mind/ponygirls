import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class PresentationPublication(
    presentationId: UUID,
    reservedSourceRef: Ref,
    payloadDigest: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = PresentationPublication.baboonDomainVersion
    override def baboonDomainIdentifier: String = PresentationPublication.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = PresentationPublication.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = PresentationPublication.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = PresentationPublication.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = PresentationPublication.baboonMinReaderVersions
  }
  
  object PresentationPublication {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#PresentationPublication"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[PresentationPublication] = PresentationPublication_JsonCodec.instance
  }
  
  object PresentationPublication_JsonCodec extends BaboonJsonCodec.BaseGenerated[PresentationPublication, BaboonJsonCodec[PresentationPublication]] {
    def encode(ctx: BaboonCodecContext, value: PresentationPublication): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "presentationId" -> Json.fromString(value.presentationId.toString()),
        "reservedSourceRef" -> Ref_JsonCodec.instance.encode(ctx, value.reservedSourceRef),
        "payloadDigest" -> Json.fromString(value.payloadDigest)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PresentationPublication] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            presentationId <- getField(jsonObject, "presentationId").flatMap(v => decodeUUID(v.hcursor))
            reservedSourceRef <- getField(jsonObject, "reservedSourceRef").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            payloadDigest <- getField(jsonObject, "payloadDigest").flatMap(v => decodeString(v.hcursor))
          } yield PresentationPublication(presentationId,reservedSourceRef,payloadDigest)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to PresentationPublication: object expected"))
      }
    }
  
    def baboonDomainVersion: String = PresentationPublication.baboonDomainVersion
    
    def baboonDomainIdentifier: String = PresentationPublication.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = PresentationPublication.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PresentationPublication]] = Lazy(PresentationPublication_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PresentationPublication]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PresentationPublication] = LazyInstance.value
  }
}