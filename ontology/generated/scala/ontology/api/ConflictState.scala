import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait ConflictState
  
  object ConflictState extends BaboonEnum[ConflictState] {
    case object Open extends ConflictState
    case object Resolved extends ConflictState
    
    def parse(s: String): Option[ConflictState] = {
      s match {
        case "Open" => Some(Open)
        case "Resolved" => Some(Resolved)
        case _ => None
      }
    }
    
    def all: List[ConflictState] = List(
      Open,
      Resolved
    ) 
  }
  
  object ConflictState_JsonCodec extends BaboonJsonCodec.Base[ConflictState, BaboonJsonCodec[ConflictState]] {
    def encode(ctx: BaboonCodecContext, value: ConflictState): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ConflictState] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ConflictState.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ConflictState: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ConflictState: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#ConflictState"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ConflictState]] = Lazy(ConflictState_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ConflictState]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ConflictState] = LazyInstance.value
  }
}