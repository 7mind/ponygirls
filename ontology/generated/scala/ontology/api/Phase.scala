import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait Phase
  
  object Phase extends BaboonEnum[Phase] {
    case object Planned extends Phase
    case object Active extends Phase
    case object Blocked extends Phase
    case object Completed extends Phase
    case object Cancelled extends Phase
    
    def parse(s: String): Option[Phase] = {
      s match {
        case "Planned" => Some(Planned)
        case "Active" => Some(Active)
        case "Blocked" => Some(Blocked)
        case "Completed" => Some(Completed)
        case "Cancelled" => Some(Cancelled)
        case _ => None
      }
    }
    
    def all: List[Phase] = List(
      Planned,
      Active,
      Blocked,
      Completed,
      Cancelled
    ) 
  }
  
  object Phase_JsonCodec extends BaboonJsonCodec.Base[Phase, BaboonJsonCodec[Phase]] {
    def encode(ctx: BaboonCodecContext, value: Phase): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Phase] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Phase.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Phase: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Phase: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#Phase"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Phase]] = Lazy(Phase_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Phase]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Phase] = LazyInstance.value
  }
}