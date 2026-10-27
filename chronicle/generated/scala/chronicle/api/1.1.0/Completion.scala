import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api.v1_1_0 {
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.5.0")
  sealed trait Completion
  
  object Completion extends BaboonEnum[Completion] {
    case object Quiescent extends Completion
    case object Closed extends Completion
    
    def parse(s: String): Option[Completion] = {
      s match {
        case "Quiescent" => Some(Quiescent)
        case "Closed" => Some(Closed)
        case _ => None
      }
    }
    
    def all: List[Completion] = List(
      Quiescent,
      Closed
    ) 
  }
  
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.5.0")
  object Completion_JsonCodec extends BaboonJsonCodec.Base[Completion, BaboonJsonCodec[Completion]] {
    def encode(ctx: BaboonCodecContext, value: Completion): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Completion] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Completion.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Completion: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Completion: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.1.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#Completion"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Completion]] = Lazy(Completion_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Completion]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Completion] = LazyInstance.value
  }
}