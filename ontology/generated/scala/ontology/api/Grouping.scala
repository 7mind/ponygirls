import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait Grouping
  
  object Grouping extends BaboonEnum[Grouping] {
    case object All extends Grouping
    case object Alternative extends Grouping
    case object Navigation extends Grouping
    
    def parse(s: String): Option[Grouping] = {
      s match {
        case "All" => Some(All)
        case "Alternative" => Some(Alternative)
        case "Navigation" => Some(Navigation)
        case _ => None
      }
    }
    
    def all: List[Grouping] = List(
      All,
      Alternative,
      Navigation
    ) 
  }
  
  object Grouping_JsonCodec extends BaboonJsonCodec.Base[Grouping, BaboonJsonCodec[Grouping]] {
    def encode(ctx: BaboonCodecContext, value: Grouping): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Grouping] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Grouping.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Grouping: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Grouping: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#Grouping"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Grouping]] = Lazy(Grouping_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Grouping]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Grouping] = LazyInstance.value
  }
}