import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class ActorRecord(
    ref: Ref,
    value: Actor
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ActorRecord.baboonDomainVersion
    override def baboonDomainIdentifier: String = ActorRecord.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ActorRecord.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ActorRecord.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ActorRecord.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ActorRecord.baboonMinReaderVersions
  }
  
  object ActorRecord {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ActorRecord"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ActorRecord] = ActorRecord_JsonCodec.instance
  }
  
  object ActorRecord_JsonCodec extends BaboonJsonCodec.BaseGenerated[ActorRecord, BaboonJsonCodec[ActorRecord]] {
    def encode(ctx: BaboonCodecContext, value: ActorRecord): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref),
        "value" -> Actor_JsonCodec.instance.encode(ctx, value.value)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActorRecord] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            value <- getField(jsonObject, "value").flatMap(v => Actor_JsonCodec.circeDecoder(v.hcursor))
          } yield ActorRecord(ref,value)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActorRecord: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ActorRecord.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ActorRecord.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ActorRecord.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActorRecord]] = Lazy(ActorRecord_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActorRecord]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActorRecord] = LazyInstance.value
  }
}