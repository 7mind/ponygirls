import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait ProjectionDisposition
  
  object ProjectionDisposition extends BaboonEnum[ProjectionDisposition] {
    case object ExactCheckpoint extends ProjectionDisposition
    case object SupersededByCheckpoint extends ProjectionDisposition
    
    def parse(s: String): Option[ProjectionDisposition] = {
      s match {
        case "ExactCheckpoint" => Some(ExactCheckpoint)
        case "SupersededByCheckpoint" => Some(SupersededByCheckpoint)
        case _ => None
      }
    }
    
    def all: List[ProjectionDisposition] = List(
      ExactCheckpoint,
      SupersededByCheckpoint
    ) 
  }
  
  object ProjectionDisposition_JsonCodec extends BaboonJsonCodec.Base[ProjectionDisposition, BaboonJsonCodec[ProjectionDisposition]] {
    def encode(ctx: BaboonCodecContext, value: ProjectionDisposition): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ProjectionDisposition] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ProjectionDisposition.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ProjectionDisposition: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ProjectionDisposition: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#ProjectionDisposition"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ProjectionDisposition]] = Lazy(ProjectionDisposition_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ProjectionDisposition]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ProjectionDisposition] = LazyInstance.value
  }
}