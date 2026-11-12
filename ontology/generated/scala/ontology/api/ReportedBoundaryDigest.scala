import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ReportedBoundaryDigest(
    encoding: String,
    digest: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ReportedBoundaryDigest.baboonDomainVersion
    override def baboonDomainIdentifier: String = ReportedBoundaryDigest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ReportedBoundaryDigest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ReportedBoundaryDigest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ReportedBoundaryDigest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ReportedBoundaryDigest.baboonMinReaderVersions
  }
  
  object ReportedBoundaryDigest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ReportedBoundaryDigest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ReportedBoundaryDigest] = ReportedBoundaryDigest_JsonCodec.instance
  }
  
  object ReportedBoundaryDigest_JsonCodec extends BaboonJsonCodec.BaseGenerated[ReportedBoundaryDigest, BaboonJsonCodec[ReportedBoundaryDigest]] {
    def encode(ctx: BaboonCodecContext, value: ReportedBoundaryDigest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "encoding" -> Json.fromString(value.encoding),
        "digest" -> Json.fromString(value.digest)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ReportedBoundaryDigest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            encoding <- getField(jsonObject, "encoding").flatMap(v => decodeString(v.hcursor))
            digest <- getField(jsonObject, "digest").flatMap(v => decodeString(v.hcursor))
          } yield ReportedBoundaryDigest(encoding,digest)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ReportedBoundaryDigest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ReportedBoundaryDigest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ReportedBoundaryDigest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ReportedBoundaryDigest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ReportedBoundaryDigest]] = Lazy(ReportedBoundaryDigest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ReportedBoundaryDigest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ReportedBoundaryDigest] = LazyInstance.value
  }
}