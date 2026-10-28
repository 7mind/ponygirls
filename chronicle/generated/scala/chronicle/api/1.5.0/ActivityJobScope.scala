import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api.v1_5_0 {
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.7.0")
  sealed trait ActivityJobScope
  
  object ActivityJobScope extends BaboonEnum[ActivityJobScope] {
    case object Current extends ActivityJobScope
    case object Historical extends ActivityJobScope
    case object All extends ActivityJobScope
    
    def parse(s: String): Option[ActivityJobScope] = {
      s match {
        case "Current" => Some(Current)
        case "Historical" => Some(Historical)
        case "All" => Some(All)
        case _ => None
      }
    }
    
    def all: List[ActivityJobScope] = List(
      Current,
      Historical,
      All
    ) 
  }
  
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.7.0")
  object ActivityJobScope_JsonCodec extends BaboonJsonCodec.Base[ActivityJobScope, BaboonJsonCodec[ActivityJobScope]] {
    def encode(ctx: BaboonCodecContext, value: ActivityJobScope): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobScope] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ActivityJobScope.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityJobScope: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityJobScope: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.5.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityJobScope"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobScope]] = Lazy(ActivityJobScope_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobScope]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityJobScope] = LazyInstance.value
  }
}