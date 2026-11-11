import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait DeliveryBoundary
  
  object DeliveryBoundary extends BaboonEnum[DeliveryBoundary] {
    case object ClientContext extends DeliveryBoundary
    case object ExtensionContext extends DeliveryBoundary
    
    def parse(s: String): Option[DeliveryBoundary] = {
      s match {
        case "ClientContext" => Some(ClientContext)
        case "ExtensionContext" => Some(ExtensionContext)
        case _ => None
      }
    }
    
    def all: List[DeliveryBoundary] = List(
      ClientContext,
      ExtensionContext
    ) 
  }
  
  object DeliveryBoundary_JsonCodec extends BaboonJsonCodec.Base[DeliveryBoundary, BaboonJsonCodec[DeliveryBoundary]] {
    def encode(ctx: BaboonCodecContext, value: DeliveryBoundary): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, DeliveryBoundary] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          DeliveryBoundary.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to DeliveryBoundary: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to DeliveryBoundary: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#DeliveryBoundary"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[DeliveryBoundary]] = Lazy(DeliveryBoundary_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[DeliveryBoundary]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[DeliveryBoundary] = LazyInstance.value
  }
}