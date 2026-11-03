import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class ByteRange(
    start: Long,
    endExclusive: Long
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ByteRange.baboonDomainVersion
    override def baboonDomainIdentifier: String = ByteRange.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ByteRange.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ByteRange.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ByteRange.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ByteRange.baboonMinReaderVersions
  }
  
  object ByteRange {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#ByteRange"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ByteRange] = ByteRange_JsonCodec.instance
  }
  
  object ByteRange_JsonCodec extends BaboonJsonCodec.BaseGenerated[ByteRange, BaboonJsonCodec[ByteRange]] {
    def encode(ctx: BaboonCodecContext, value: ByteRange): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "start" -> Json.fromString(value.start.toString),
        "endExclusive" -> Json.fromString(value.endExclusive.toString)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ByteRange] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            start <- getField(jsonObject, "start").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            endExclusive <- getField(jsonObject, "endExclusive").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
          } yield ByteRange(start,endExclusive)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ByteRange: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ByteRange.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ByteRange.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ByteRange.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ByteRange]] = Lazy(ByteRange_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ByteRange]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ByteRange] = LazyInstance.value
  }
}