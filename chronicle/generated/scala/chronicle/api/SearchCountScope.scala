import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api {
  sealed trait SearchCountScope
  
  object SearchCountScope extends BaboonEnum[SearchCountScope] {
    case object ExactMatches extends SearchCountScope
    case object CandidateWindow extends SearchCountScope
    
    def parse(s: String): Option[SearchCountScope] = {
      s match {
        case "ExactMatches" => Some(ExactMatches)
        case "CandidateWindow" => Some(CandidateWindow)
        case _ => None
      }
    }
    
    def all: List[SearchCountScope] = List(
      ExactMatches,
      CandidateWindow
    ) 
  }
  
  object SearchCountScope_JsonCodec extends BaboonJsonCodec.Base[SearchCountScope, BaboonJsonCodec[SearchCountScope]] {
    def encode(ctx: BaboonCodecContext, value: SearchCountScope): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SearchCountScope] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          SearchCountScope.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to SearchCountScope: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to SearchCountScope: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.5.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#SearchCountScope"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SearchCountScope]] = Lazy(SearchCountScope_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SearchCountScope]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SearchCountScope] = LazyInstance.value
  }
}