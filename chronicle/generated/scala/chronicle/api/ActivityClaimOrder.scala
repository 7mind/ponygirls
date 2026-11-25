import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api {
  sealed trait ActivityClaimOrder
  
  object ActivityClaimOrder extends BaboonEnum[ActivityClaimOrder] {
    case object SourceId extends ActivityClaimOrder
    case object Waiting extends ActivityClaimOrder
    
    def parse(s: String): Option[ActivityClaimOrder] = {
      s match {
        case "SourceId" => Some(SourceId)
        case "Waiting" => Some(Waiting)
        case _ => None
      }
    }
    
    def all: List[ActivityClaimOrder] = List(
      SourceId,
      Waiting
    ) 
  }
  
  object ActivityClaimOrder_JsonCodec extends BaboonJsonCodec.Base[ActivityClaimOrder, BaboonJsonCodec[ActivityClaimOrder]] {
    def encode(ctx: BaboonCodecContext, value: ActivityClaimOrder): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityClaimOrder] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ActivityClaimOrder.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityClaimOrder: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityClaimOrder: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.9.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityClaimOrder"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityClaimOrder]] = Lazy(ActivityClaimOrder_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityClaimOrder]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityClaimOrder] = LazyInstance.value
  }
}