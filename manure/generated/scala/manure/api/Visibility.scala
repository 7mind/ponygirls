import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package manure.api {
  sealed trait Visibility
  
  object Visibility extends BaboonEnum[Visibility] {
    case object Internal extends Visibility
    case object External extends Visibility
    case object Public extends Visibility
    
    def parse(s: String): Option[Visibility] = {
      s match {
        case "Internal" => Some(Internal)
        case "External" => Some(External)
        case "Public" => Some(Public)
        case _ => None
      }
    }
    
    def all: List[Visibility] = List(
      Internal,
      External,
      Public
    ) 
  }
  
  object Visibility_JsonCodec extends BaboonJsonCodec.Base[Visibility, BaboonJsonCodec[Visibility]] {
    def encode(ctx: BaboonCodecContext, value: Visibility): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Visibility] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Visibility.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Visibility: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Visibility: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.0.0"
    
    def baboonDomainIdentifier: String = "manure.api"
    
    def baboonTypeIdentifier: String = "manure.api/:#Visibility"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Visibility]] = Lazy(Visibility_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Visibility]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Visibility] = LazyInstance.value
  }
}