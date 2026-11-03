import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package haystack.api {
  sealed trait RetrievalMode
  
  object RetrievalMode extends BaboonEnum[RetrievalMode] {
    case object Lexical extends RetrievalMode
    case object Semantic extends RetrievalMode
    case object Hybrid extends RetrievalMode
    
    def parse(s: String): Option[RetrievalMode] = {
      s match {
        case "Lexical" => Some(Lexical)
        case "Semantic" => Some(Semantic)
        case "Hybrid" => Some(Hybrid)
        case _ => None
      }
    }
    
    def all: List[RetrievalMode] = List(
      Lexical,
      Semantic,
      Hybrid
    ) 
  }
  
  object RetrievalMode_JsonCodec extends BaboonJsonCodec.Base[RetrievalMode, BaboonJsonCodec[RetrievalMode]] {
    def encode(ctx: BaboonCodecContext, value: RetrievalMode): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RetrievalMode] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          RetrievalMode.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to RetrievalMode: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to RetrievalMode: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.0.0"
    
    def baboonDomainIdentifier: String = "haystack.api"
    
    def baboonTypeIdentifier: String = "haystack.api/:#RetrievalMode"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RetrievalMode]] = Lazy(RetrievalMode_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RetrievalMode]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RetrievalMode] = LazyInstance.value
  }
}