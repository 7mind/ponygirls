import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait Gate
  
  object Gate extends BaboonEnum[Gate] {
    case object Completion extends Gate
    case object Fulfillment extends Gate
    
    def parse(s: String): Option[Gate] = {
      s match {
        case "Completion" => Some(Completion)
        case "Fulfillment" => Some(Fulfillment)
        case _ => None
      }
    }
    
    def all: List[Gate] = List(
      Completion,
      Fulfillment
    ) 
  }
  
  object Gate_JsonCodec extends BaboonJsonCodec.Base[Gate, BaboonJsonCodec[Gate]] {
    def encode(ctx: BaboonCodecContext, value: Gate): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Gate] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Gate.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Gate: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Gate: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#Gate"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Gate]] = Lazy(Gate_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Gate]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Gate] = LazyInstance.value
  }
}