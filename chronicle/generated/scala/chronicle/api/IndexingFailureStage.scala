import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api {
  sealed trait IndexingFailureStage
  
  object IndexingFailureStage extends BaboonEnum[IndexingFailureStage] {
    case object Annotation extends IndexingFailureStage
    case object Embedding extends IndexingFailureStage
    case object Publication extends IndexingFailureStage
    
    def parse(s: String): Option[IndexingFailureStage] = {
      s match {
        case "Annotation" => Some(Annotation)
        case "Embedding" => Some(Embedding)
        case "Publication" => Some(Publication)
        case _ => None
      }
    }
    
    def all: List[IndexingFailureStage] = List(
      Annotation,
      Embedding,
      Publication
    ) 
  }
  
  object IndexingFailureStage_JsonCodec extends BaboonJsonCodec.Base[IndexingFailureStage, BaboonJsonCodec[IndexingFailureStage]] {
    def encode(ctx: BaboonCodecContext, value: IndexingFailureStage): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, IndexingFailureStage] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          IndexingFailureStage.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to IndexingFailureStage: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to IndexingFailureStage: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.7.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#IndexingFailureStage"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[IndexingFailureStage]] = Lazy(IndexingFailureStage_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[IndexingFailureStage]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[IndexingFailureStage] = LazyInstance.value
  }
}