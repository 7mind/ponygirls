import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ContextRecord(
    origin: OriginContext,
    reportedInherited: List[ReportedInheritance]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ContextRecord.baboonDomainVersion
    override def baboonDomainIdentifier: String = ContextRecord.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ContextRecord.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ContextRecord.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ContextRecord.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ContextRecord.baboonMinReaderVersions
  }
  
  object ContextRecord {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ContextRecord"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ContextRecord] = ContextRecord_JsonCodec.instance
  }
  
  object ContextRecord_JsonCodec extends BaboonJsonCodec.BaseGenerated[ContextRecord, BaboonJsonCodec[ContextRecord]] {
    def encode(ctx: BaboonCodecContext, value: ContextRecord): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "origin" -> OriginContext_JsonCodec.instance.encode(ctx, value.origin),
        "reportedInherited" -> Json.fromValues(value.reportedInherited.map(e => ReportedInheritance_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContextRecord] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            origin <- getField(jsonObject, "origin").flatMap(v => OriginContext_JsonCodec.circeDecoder(v.hcursor))
            reportedInherited <- getField(jsonObject, "reportedInherited").flatMap(v => decodeList(ReportedInheritance_JsonCodec.circeDecoder)(v.hcursor))
          } yield ContextRecord(origin,reportedInherited)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ContextRecord: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ContextRecord.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ContextRecord.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ContextRecord.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContextRecord]] = Lazy(ContextRecord_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ContextRecord]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ContextRecord] = LazyInstance.value
  }
}