import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait AdoptionOrigin
  
  object AdoptionOrigin extends BaboonEnum[AdoptionOrigin] {
    case object Interpretation extends AdoptionOrigin
    case object CapturedAction extends AdoptionOrigin
    
    def parse(s: String): Option[AdoptionOrigin] = {
      s match {
        case "Interpretation" => Some(Interpretation)
        case "CapturedAction" => Some(CapturedAction)
        case _ => None
      }
    }
    
    def all: List[AdoptionOrigin] = List(
      Interpretation,
      CapturedAction
    ) 
  }
  
  object AdoptionOrigin_JsonCodec extends BaboonJsonCodec.Base[AdoptionOrigin, BaboonJsonCodec[AdoptionOrigin]] {
    def encode(ctx: BaboonCodecContext, value: AdoptionOrigin): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, AdoptionOrigin] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          AdoptionOrigin.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to AdoptionOrigin: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to AdoptionOrigin: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#AdoptionOrigin"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[AdoptionOrigin]] = Lazy(AdoptionOrigin_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[AdoptionOrigin]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[AdoptionOrigin] = LazyInstance.value
  }
}