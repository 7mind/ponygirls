import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package manure.api {
  sealed trait ContentMode
  
  object ContentMode extends BaboonEnum[ContentMode] {
    case object Subdomain extends ContentMode
    case object Path extends ContentMode
    
    def parse(s: String): Option[ContentMode] = {
      s match {
        case "Subdomain" => Some(Subdomain)
        case "Path" => Some(Path)
        case _ => None
      }
    }
    
    def all: List[ContentMode] = List(
      Subdomain,
      Path
    ) 
  }
  
  object ContentMode_JsonCodec extends BaboonJsonCodec.Base[ContentMode, BaboonJsonCodec[ContentMode]] {
    def encode(ctx: BaboonCodecContext, value: ContentMode): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentMode] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ContentMode.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ContentMode: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ContentMode: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.0.0"
    
    def baboonDomainIdentifier: String = "manure.api"
    
    def baboonTypeIdentifier: String = "manure.api/:#ContentMode"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentMode]] = Lazy(ContentMode_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentMode]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ContentMode] = LazyInstance.value
  }
}