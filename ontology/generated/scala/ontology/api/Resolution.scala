import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait Resolution
  
  object Resolution extends BaboonEnum[Resolution] {
    case object Fulfilled extends Resolution
    case object NotFulfilled extends Resolution
    case object Inconclusive extends Resolution
    
    def parse(s: String): Option[Resolution] = {
      s match {
        case "Fulfilled" => Some(Fulfilled)
        case "NotFulfilled" => Some(NotFulfilled)
        case "Inconclusive" => Some(Inconclusive)
        case _ => None
      }
    }
    
    def all: List[Resolution] = List(
      Fulfilled,
      NotFulfilled,
      Inconclusive
    ) 
  }
  
  object Resolution_JsonCodec extends BaboonJsonCodec.Base[Resolution, BaboonJsonCodec[Resolution]] {
    def encode(ctx: BaboonCodecContext, value: Resolution): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Resolution] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Resolution.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Resolution: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Resolution: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#Resolution"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Resolution]] = Lazy(Resolution_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Resolution]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Resolution] = LazyInstance.value
  }
}