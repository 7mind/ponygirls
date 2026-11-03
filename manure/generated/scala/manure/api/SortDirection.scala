import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package manure.api {
  sealed trait SortDirection
  
  object SortDirection extends BaboonEnum[SortDirection] {
    case object Asc extends SortDirection
    case object Desc extends SortDirection
    
    def parse(s: String): Option[SortDirection] = {
      s match {
        case "Asc" => Some(Asc)
        case "Desc" => Some(Desc)
        case _ => None
      }
    }
    
    def all: List[SortDirection] = List(
      Asc,
      Desc
    ) 
  }
  
  object SortDirection_JsonCodec extends BaboonJsonCodec.Base[SortDirection, BaboonJsonCodec[SortDirection]] {
    def encode(ctx: BaboonCodecContext, value: SortDirection): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SortDirection] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          SortDirection.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to SortDirection: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to SortDirection: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.0.0"
    
    def baboonDomainIdentifier: String = "manure.api"
    
    def baboonTypeIdentifier: String = "manure.api/:#SortDirection"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SortDirection]] = Lazy(SortDirection_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SortDirection]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SortDirection] = LazyInstance.value
  }
}