import io.circe.Decoder.{decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  final case class ReviewResponseLink(
    presentationId: UUID,
    judgmentId: UUID,
    presentationSource: Ref,
    payloadDigest: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ReviewResponseLink.baboonDomainVersion
    override def baboonDomainIdentifier: String = ReviewResponseLink.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ReviewResponseLink.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ReviewResponseLink.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ReviewResponseLink.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ReviewResponseLink.baboonMinReaderVersions
  }
  
  object ReviewResponseLink {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ReviewResponseLink"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ReviewResponseLink] = ReviewResponseLink_JsonCodec.instance
  }
  
  object ReviewResponseLink_JsonCodec extends BaboonJsonCodec.BaseGenerated[ReviewResponseLink, BaboonJsonCodec[ReviewResponseLink]] {
    def encode(ctx: BaboonCodecContext, value: ReviewResponseLink): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "presentationId" -> Json.fromString(value.presentationId.toString()),
        "judgmentId" -> Json.fromString(value.judgmentId.toString()),
        "presentationSource" -> Ref_JsonCodec.instance.encode(ctx, value.presentationSource),
        "payloadDigest" -> Json.fromString(value.payloadDigest)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ReviewResponseLink] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            presentationId <- getField(jsonObject, "presentationId").flatMap(v => decodeUUID(v.hcursor))
            judgmentId <- getField(jsonObject, "judgmentId").flatMap(v => decodeUUID(v.hcursor))
            presentationSource <- getField(jsonObject, "presentationSource").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            payloadDigest <- getField(jsonObject, "payloadDigest").flatMap(v => decodeString(v.hcursor))
          } yield ReviewResponseLink(presentationId,judgmentId,presentationSource,payloadDigest)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ReviewResponseLink: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ReviewResponseLink.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ReviewResponseLink.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ReviewResponseLink.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ReviewResponseLink]] = Lazy(ReviewResponseLink_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ReviewResponseLink]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ReviewResponseLink] = LazyInstance.value
  }
}