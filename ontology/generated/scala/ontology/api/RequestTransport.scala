import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait RequestTransport
  
  object RequestTransport extends BaboonEnum[RequestTransport] {
    case object Bearer extends RequestTransport
    case object Cookie extends RequestTransport
    case object Internal extends RequestTransport
    
    def parse(s: String): Option[RequestTransport] = {
      s match {
        case "Bearer" => Some(Bearer)
        case "Cookie" => Some(Cookie)
        case "Internal" => Some(Internal)
        case _ => None
      }
    }
    
    def all: List[RequestTransport] = List(
      Bearer,
      Cookie,
      Internal
    ) 
  }
  
  object RequestTransport_JsonCodec extends BaboonJsonCodec.Base[RequestTransport, BaboonJsonCodec[RequestTransport]] {
    def encode(ctx: BaboonCodecContext, value: RequestTransport): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RequestTransport] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          RequestTransport.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to RequestTransport: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to RequestTransport: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#RequestTransport"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RequestTransport]] = Lazy(RequestTransport_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RequestTransport]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RequestTransport] = LazyInstance.value
  }
}