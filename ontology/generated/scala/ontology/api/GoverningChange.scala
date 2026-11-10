import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class GoverningChange(
    previous: Ref,
    current: Ref,
    reason: String,
    humanBasis: List[CapturedEvent]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = GoverningChange.baboonDomainVersion
    override def baboonDomainIdentifier: String = GoverningChange.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = GoverningChange.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = GoverningChange.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = GoverningChange.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = GoverningChange.baboonMinReaderVersions
  }
  
  object GoverningChange {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#GoverningChange"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[GoverningChange] = GoverningChange_JsonCodec.instance
  }
  
  object GoverningChange_JsonCodec extends BaboonJsonCodec.BaseGenerated[GoverningChange, BaboonJsonCodec[GoverningChange]] {
    def encode(ctx: BaboonCodecContext, value: GoverningChange): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "previous" -> Ref_JsonCodec.instance.encode(ctx, value.previous),
        "current" -> Ref_JsonCodec.instance.encode(ctx, value.current),
        "reason" -> Json.fromString(value.reason),
        "humanBasis" -> Json.fromValues(value.humanBasis.map(e => CapturedEvent_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GoverningChange] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            previous <- getField(jsonObject, "previous").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            current <- getField(jsonObject, "current").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            reason <- getField(jsonObject, "reason").flatMap(v => decodeString(v.hcursor))
            humanBasis <- getField(jsonObject, "humanBasis").flatMap(v => decodeList(CapturedEvent_JsonCodec.circeDecoder)(v.hcursor))
          } yield GoverningChange(previous,current,reason,humanBasis)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to GoverningChange: object expected"))
      }
    }
  
    def baboonDomainVersion: String = GoverningChange.baboonDomainVersion
    
    def baboonDomainIdentifier: String = GoverningChange.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = GoverningChange.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GoverningChange]] = Lazy(GoverningChange_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[GoverningChange]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[GoverningChange] = LazyInstance.value
  }
}