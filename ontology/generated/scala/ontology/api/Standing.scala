import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait Standing
  
  object Standing extends BaboonEnum[Standing] {
    case object Active extends Standing
    case object Superseded extends Standing
    case object Withdrawn extends Standing
    
    def parse(s: String): Option[Standing] = {
      s match {
        case "Active" => Some(Active)
        case "Superseded" => Some(Superseded)
        case "Withdrawn" => Some(Withdrawn)
        case _ => None
      }
    }
    
    def all: List[Standing] = List(
      Active,
      Superseded,
      Withdrawn
    ) 
  }
  
  object Standing_JsonCodec extends BaboonJsonCodec.Base[Standing, BaboonJsonCodec[Standing]] {
    def encode(ctx: BaboonCodecContext, value: Standing): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Standing] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Standing.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Standing: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Standing: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#Standing"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Standing]] = Lazy(Standing_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Standing]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Standing] = LazyInstance.value
  }
}