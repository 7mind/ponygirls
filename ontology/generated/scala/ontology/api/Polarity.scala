import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait Polarity
  
  object Polarity extends BaboonEnum[Polarity] {
    case object Required extends Polarity
    case object Prohibited extends Polarity
    
    def parse(s: String): Option[Polarity] = {
      s match {
        case "Required" => Some(Required)
        case "Prohibited" => Some(Prohibited)
        case _ => None
      }
    }
    
    def all: List[Polarity] = List(
      Required,
      Prohibited
    ) 
  }
  
  object Polarity_JsonCodec extends BaboonJsonCodec.Base[Polarity, BaboonJsonCodec[Polarity]] {
    def encode(ctx: BaboonCodecContext, value: Polarity): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Polarity] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Polarity.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Polarity: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Polarity: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#Polarity"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Polarity]] = Lazy(Polarity_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Polarity]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Polarity] = LazyInstance.value
  }
}