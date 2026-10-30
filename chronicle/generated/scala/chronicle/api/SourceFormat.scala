import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api {
  sealed trait SourceFormat
  
  object SourceFormat extends BaboonEnum[SourceFormat] {
    case object Claude extends SourceFormat
    case object Codex extends SourceFormat
    case object Pi extends SourceFormat
    
    def parse(s: String): Option[SourceFormat] = {
      s match {
        case "Claude" => Some(Claude)
        case "Codex" => Some(Codex)
        case "Pi" => Some(Pi)
        case _ => None
      }
    }
    
    def all: List[SourceFormat] = List(
      Claude,
      Codex,
      Pi
    ) 
  }
  
  object SourceFormat_JsonCodec extends BaboonJsonCodec.Base[SourceFormat, BaboonJsonCodec[SourceFormat]] {
    def encode(ctx: BaboonCodecContext, value: SourceFormat): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SourceFormat] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          SourceFormat.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to SourceFormat: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to SourceFormat: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.9.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#SourceFormat"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SourceFormat]] = Lazy(SourceFormat_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SourceFormat]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SourceFormat] = LazyInstance.value
  }
}