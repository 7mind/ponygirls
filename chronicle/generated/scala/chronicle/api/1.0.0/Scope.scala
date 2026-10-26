import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api.v1_0_0 {
  @deprecated("Version 1.0.0 is deprecated, you should migrate to 1.2.0")
  sealed trait Scope
  
  object Scope extends BaboonEnum[Scope] {
    case object Ingest extends Scope
    case object Read extends Scope
    case object Raw extends Scope
    
    def parse(s: String): Option[Scope] = {
      s match {
        case "Ingest" => Some(Ingest)
        case "Read" => Some(Read)
        case "Raw" => Some(Raw)
        case _ => None
      }
    }
    
    def all: List[Scope] = List(
      Ingest,
      Read,
      Raw
    ) 
  }
  
  @deprecated("Version 1.0.0 is deprecated, you should migrate to 1.2.0")
  object Scope_JsonCodec extends BaboonJsonCodec.Base[Scope, BaboonJsonCodec[Scope]] {
    def encode(ctx: BaboonCodecContext, value: Scope): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Scope] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Scope.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Scope: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Scope: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.0.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#Scope"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Scope]] = Lazy(Scope_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Scope]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Scope] = LazyInstance.value
  }
}