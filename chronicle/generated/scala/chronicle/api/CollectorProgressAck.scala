import io.circe.Decoder.decodeBoolean
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class CollectorProgressAck(
    sequence: Long,
    accepted: Boolean
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CollectorProgressAck.baboonDomainVersion
    override def baboonDomainIdentifier: String = CollectorProgressAck.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CollectorProgressAck.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CollectorProgressAck.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CollectorProgressAck.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CollectorProgressAck.baboonMinReaderVersions
  }
  
  object CollectorProgressAck {
    def baboonDomainVersion: String = "1.7.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#CollectorProgressAck"
    private lazy val _baboonSameInVersions: List[String] = List("1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.2.0", "prefix-compact" -> "1.2.0", "prefix-any-mode" -> "1.2.0", "identical" -> "1.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CollectorProgressAck] = CollectorProgressAck_JsonCodec.instance
  }
  
  object CollectorProgressAck_JsonCodec extends BaboonJsonCodec.BaseGenerated[CollectorProgressAck, BaboonJsonCodec[CollectorProgressAck]] {
    def encode(ctx: BaboonCodecContext, value: CollectorProgressAck): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "sequence" -> Json.fromString(value.sequence.toString),
        "accepted" -> Json.fromBoolean(value.accepted)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CollectorProgressAck] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            sequence <- getField(jsonObject, "sequence").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            accepted <- getField(jsonObject, "accepted").flatMap(v => decodeBoolean(v.hcursor))
          } yield CollectorProgressAck(sequence,accepted)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CollectorProgressAck: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CollectorProgressAck.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CollectorProgressAck.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CollectorProgressAck.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CollectorProgressAck]] = Lazy(CollectorProgressAck_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CollectorProgressAck]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CollectorProgressAck] = LazyInstance.value
  }
}