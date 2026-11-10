import io.circe.Decoder.decodeBoolean
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class Ack(
    ok: Boolean
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Ack.baboonDomainVersion
    override def baboonDomainIdentifier: String = Ack.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Ack.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Ack.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Ack.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Ack.baboonMinReaderVersions
  }
  
  object Ack {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Ack"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Ack] = Ack_JsonCodec.instance
  }
  
  object Ack_JsonCodec extends BaboonJsonCodec.BaseGenerated[Ack, BaboonJsonCodec[Ack]] {
    def encode(ctx: BaboonCodecContext, value: Ack): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "ok" -> Json.fromBoolean(value.ok)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Ack] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            ok <- getField(jsonObject, "ok").flatMap(v => decodeBoolean(v.hcursor))
          } yield Ack(ok)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Ack: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Ack.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Ack.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Ack.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Ack]] = Lazy(Ack_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Ack]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Ack] = LazyInstance.value
  }
}