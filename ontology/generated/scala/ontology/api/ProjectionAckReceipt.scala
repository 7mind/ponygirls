import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ProjectionAckReceipt(
    input: ProjectionAckInput,
    disposition: ProjectionDisposition,
    recordedAt: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ProjectionAckReceipt.baboonDomainVersion
    override def baboonDomainIdentifier: String = ProjectionAckReceipt.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ProjectionAckReceipt.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ProjectionAckReceipt.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ProjectionAckReceipt.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ProjectionAckReceipt.baboonMinReaderVersions
  }
  
  object ProjectionAckReceipt {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ProjectionAckReceipt"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ProjectionAckReceipt] = ProjectionAckReceipt_JsonCodec.instance
  }
  
  object ProjectionAckReceipt_JsonCodec extends BaboonJsonCodec.BaseGenerated[ProjectionAckReceipt, BaboonJsonCodec[ProjectionAckReceipt]] {
    def encode(ctx: BaboonCodecContext, value: ProjectionAckReceipt): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "input" -> ProjectionAckInput_JsonCodec.instance.encode(ctx, value.input),
        "disposition" -> ProjectionDisposition_JsonCodec.instance.encode(ctx, value.disposition),
        "recordedAt" -> Json.fromString(value.recordedAt)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ProjectionAckReceipt] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            input <- getField(jsonObject, "input").flatMap(v => ProjectionAckInput_JsonCodec.circeDecoder(v.hcursor))
            disposition <- getField(jsonObject, "disposition").flatMap(v => ProjectionDisposition_JsonCodec.circeDecoder(v.hcursor))
            recordedAt <- getField(jsonObject, "recordedAt").flatMap(v => decodeString(v.hcursor))
          } yield ProjectionAckReceipt(input,disposition,recordedAt)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ProjectionAckReceipt: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ProjectionAckReceipt.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ProjectionAckReceipt.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ProjectionAckReceipt.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ProjectionAckReceipt]] = Lazy(ProjectionAckReceipt_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ProjectionAckReceipt]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ProjectionAckReceipt] = LazyInstance.value
  }
}