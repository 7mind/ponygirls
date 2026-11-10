import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class Actor(
    id: String,
    kind: ActorKind
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Actor.baboonDomainVersion
    override def baboonDomainIdentifier: String = Actor.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Actor.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Actor.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Actor.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Actor.baboonMinReaderVersions
  }
  
  object Actor {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Actor"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Actor] = Actor_JsonCodec.instance
  }
  
  object Actor_JsonCodec extends BaboonJsonCodec.BaseGenerated[Actor, BaboonJsonCodec[Actor]] {
    def encode(ctx: BaboonCodecContext, value: Actor): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id),
        "kind" -> ActorKind_JsonCodec.instance.encode(ctx, value.kind)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Actor] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeString(v.hcursor))
            kind <- getField(jsonObject, "kind").flatMap(v => ActorKind_JsonCodec.circeDecoder(v.hcursor))
          } yield Actor(id,kind)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Actor: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Actor.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Actor.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Actor.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Actor]] = Lazy(Actor_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Actor]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Actor] = LazyInstance.value
  }
}