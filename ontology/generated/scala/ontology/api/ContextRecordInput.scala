import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ContextRecordInput(
    origin: OriginContextInput,
    reportedInherited: List[ReportedInheritance]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ContextRecordInput.baboonDomainVersion
    override def baboonDomainIdentifier: String = ContextRecordInput.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ContextRecordInput.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ContextRecordInput.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ContextRecordInput.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ContextRecordInput.baboonMinReaderVersions
  }
  
  object ContextRecordInput {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ContextRecordInput"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ContextRecordInput] = ContextRecordInput_JsonCodec.instance
  }
  
  object ContextRecordInput_JsonCodec extends BaboonJsonCodec.BaseGenerated[ContextRecordInput, BaboonJsonCodec[ContextRecordInput]] {
    def encode(ctx: BaboonCodecContext, value: ContextRecordInput): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "origin" -> OriginContextInput_JsonCodec.instance.encode(ctx, value.origin),
        "reportedInherited" -> Json.fromValues(value.reportedInherited.map(e => ReportedInheritance_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContextRecordInput] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            origin <- getField(jsonObject, "origin").flatMap(v => OriginContextInput_JsonCodec.circeDecoder(v.hcursor))
            reportedInherited <- getField(jsonObject, "reportedInherited").flatMap(v => decodeList(ReportedInheritance_JsonCodec.circeDecoder)(v.hcursor))
          } yield ContextRecordInput(origin,reportedInherited)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ContextRecordInput: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ContextRecordInput.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ContextRecordInput.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ContextRecordInput.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContextRecordInput]] = Lazy(ContextRecordInput_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ContextRecordInput]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ContextRecordInput] = LazyInstance.value
  }
}