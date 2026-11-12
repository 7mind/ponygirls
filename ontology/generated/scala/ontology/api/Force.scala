import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait Force
  
  object Force extends BaboonEnum[Force] {
    case object Required extends Force
    case object Preferred extends Force
    case object Unresolved extends Force
    
    def parse(s: String): Option[Force] = {
      s match {
        case "Required" => Some(Required)
        case "Preferred" => Some(Preferred)
        case "Unresolved" => Some(Unresolved)
        case _ => None
      }
    }
    
    def all: List[Force] = List(
      Required,
      Preferred,
      Unresolved
    ) 
  }
  
  object Force_JsonCodec extends BaboonJsonCodec.Base[Force, BaboonJsonCodec[Force]] {
    def encode(ctx: BaboonCodecContext, value: Force): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Force] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Force.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Force: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Force: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#Force"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Force]] = Lazy(Force_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Force]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Force] = LazyInstance.value
  }
}