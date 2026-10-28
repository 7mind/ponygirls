import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api.v1_6_0 {
  @deprecated("Version 1.6.0 is deprecated, you should migrate to 1.7.0")
  sealed trait SearchMode
  
  object SearchMode extends BaboonEnum[SearchMode] {
    case object Lexical extends SearchMode
    case object Semantic extends SearchMode
    case object Hybrid extends SearchMode
    
    def parse(s: String): Option[SearchMode] = {
      s match {
        case "Lexical" => Some(Lexical)
        case "Semantic" => Some(Semantic)
        case "Hybrid" => Some(Hybrid)
        case _ => None
      }
    }
    
    def all: List[SearchMode] = List(
      Lexical,
      Semantic,
      Hybrid
    ) 
  }
  
  @deprecated("Version 1.6.0 is deprecated, you should migrate to 1.7.0")
  object SearchMode_JsonCodec extends BaboonJsonCodec.Base[SearchMode, BaboonJsonCodec[SearchMode]] {
    def encode(ctx: BaboonCodecContext, value: SearchMode): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SearchMode] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          SearchMode.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to SearchMode: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to SearchMode: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.6.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#SearchMode"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SearchMode]] = Lazy(SearchMode_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SearchMode]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SearchMode] = LazyInstance.value
  }
}