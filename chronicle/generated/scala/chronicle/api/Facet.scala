import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class Facet(
    value: String,
    count: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Facet.baboonDomainVersion
    override def baboonDomainIdentifier: String = Facet.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Facet.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Facet.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Facet.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Facet.baboonMinReaderVersions
  }
  
  object Facet {
    def baboonDomainVersion: String = "1.3.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#Facet"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.3.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Facet] = Facet_JsonCodec.instance
  }
  
  object Facet_JsonCodec extends BaboonJsonCodec.BaseGenerated[Facet, BaboonJsonCodec[Facet]] {
    def encode(ctx: BaboonCodecContext, value: Facet): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "value" -> Json.fromString(value.value),
        "count" -> Json.fromInt(value.count)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Facet] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            value <- getField(jsonObject, "value").flatMap(v => decodeString(v.hcursor))
            count <- getField(jsonObject, "count").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield Facet(value,count)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Facet: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Facet.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Facet.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Facet.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Facet]] = Lazy(Facet_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Facet]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Facet] = LazyInstance.value
  }
}