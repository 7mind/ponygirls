import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait Escalation
  
  object Escalation extends BaboonEnum[Escalation] {
    case object NoEscalation extends Escalation
    case object HumanRequired extends Escalation
    case object Unresolved extends Escalation
    
    def parse(s: String): Option[Escalation] = {
      s match {
        case "NoEscalation" => Some(NoEscalation)
        case "HumanRequired" => Some(HumanRequired)
        case "Unresolved" => Some(Unresolved)
        case _ => None
      }
    }
    
    def all: List[Escalation] = List(
      NoEscalation,
      HumanRequired,
      Unresolved
    ) 
  }
  
  object Escalation_JsonCodec extends BaboonJsonCodec.Base[Escalation, BaboonJsonCodec[Escalation]] {
    def encode(ctx: BaboonCodecContext, value: Escalation): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Escalation] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Escalation.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Escalation: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Escalation: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#Escalation"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Escalation]] = Lazy(Escalation_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Escalation]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Escalation] = LazyInstance.value
  }
}