import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait Consumption
  
  object Consumption extends BaboonEnum[Consumption] {
    case object Current extends Consumption
    case object Historical extends Consumption
    
    def parse(s: String): Option[Consumption] = {
      s match {
        case "Current" => Some(Current)
        case "Historical" => Some(Historical)
        case _ => None
      }
    }
    
    def all: List[Consumption] = List(
      Current,
      Historical
    ) 
  }
  
  object Consumption_JsonCodec extends BaboonJsonCodec.Base[Consumption, BaboonJsonCodec[Consumption]] {
    def encode(ctx: BaboonCodecContext, value: Consumption): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Consumption] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Consumption.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Consumption: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Consumption: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#Consumption"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Consumption]] = Lazy(Consumption_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Consumption]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Consumption] = LazyInstance.value
  }
}