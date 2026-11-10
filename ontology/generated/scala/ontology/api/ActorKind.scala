import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait ActorKind
  
  object ActorKind extends BaboonEnum[ActorKind] {
    case object Human extends ActorKind
    case object Agent extends ActorKind
    case object Collector extends ActorKind
    case object Service extends ActorKind
    case object Unknown extends ActorKind
    
    def parse(s: String): Option[ActorKind] = {
      s match {
        case "Human" => Some(Human)
        case "Agent" => Some(Agent)
        case "Collector" => Some(Collector)
        case "Service" => Some(Service)
        case "Unknown" => Some(Unknown)
        case _ => None
      }
    }
    
    def all: List[ActorKind] = List(
      Human,
      Agent,
      Collector,
      Service,
      Unknown
    ) 
  }
  
  object ActorKind_JsonCodec extends BaboonJsonCodec.Base[ActorKind, BaboonJsonCodec[ActorKind]] {
    def encode(ctx: BaboonCodecContext, value: ActorKind): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActorKind] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ActorKind.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ActorKind: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ActorKind: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#ActorKind"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActorKind]] = Lazy(ActorKind_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActorKind]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActorKind] = LazyInstance.value
  }
}