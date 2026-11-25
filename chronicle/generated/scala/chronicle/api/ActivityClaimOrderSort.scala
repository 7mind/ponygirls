import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api {
  sealed trait ActivityClaimOrderSort
  
  object ActivityClaimOrderSort extends BaboonEnum[ActivityClaimOrderSort] {
    case object WaitingSince extends ActivityClaimOrderSort
    case object JobClass extends ActivityClaimOrderSort
    case object WaitingReason extends ActivityClaimOrderSort
    
    def parse(s: String): Option[ActivityClaimOrderSort] = {
      s match {
        case "WaitingSince" => Some(WaitingSince)
        case "JobClass" => Some(JobClass)
        case "WaitingReason" => Some(WaitingReason)
        case _ => None
      }
    }
    
    def all: List[ActivityClaimOrderSort] = List(
      WaitingSince,
      JobClass,
      WaitingReason
    ) 
  }
  
  object ActivityClaimOrderSort_JsonCodec extends BaboonJsonCodec.Base[ActivityClaimOrderSort, BaboonJsonCodec[ActivityClaimOrderSort]] {
    def encode(ctx: BaboonCodecContext, value: ActivityClaimOrderSort): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityClaimOrderSort] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ActivityClaimOrderSort.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityClaimOrderSort: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityClaimOrderSort: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.9.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityClaimOrderSort"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityClaimOrderSort]] = Lazy(ActivityClaimOrderSort_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityClaimOrderSort]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityClaimOrderSort] = LazyInstance.value
  }
}