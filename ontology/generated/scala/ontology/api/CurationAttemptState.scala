import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait CurationAttemptState
  
  object CurationAttemptState extends BaboonEnum[CurationAttemptState] {
    case object Claimed extends CurationAttemptState
    case object InputSealed extends CurationAttemptState
    case object Running extends CurationAttemptState
    case object Published extends CurationAttemptState
    case object Failed extends CurationAttemptState
    case object Stale extends CurationAttemptState
    case object Interrupted extends CurationAttemptState
    
    def parse(s: String): Option[CurationAttemptState] = {
      s match {
        case "Claimed" => Some(Claimed)
        case "InputSealed" => Some(InputSealed)
        case "Running" => Some(Running)
        case "Published" => Some(Published)
        case "Failed" => Some(Failed)
        case "Stale" => Some(Stale)
        case "Interrupted" => Some(Interrupted)
        case _ => None
      }
    }
    
    def all: List[CurationAttemptState] = List(
      Claimed,
      InputSealed,
      Running,
      Published,
      Failed,
      Stale,
      Interrupted
    ) 
  }
  
  object CurationAttemptState_JsonCodec extends BaboonJsonCodec.Base[CurationAttemptState, BaboonJsonCodec[CurationAttemptState]] {
    def encode(ctx: BaboonCodecContext, value: CurationAttemptState): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationAttemptState] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          CurationAttemptState.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CurationAttemptState: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CurationAttemptState: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#CurationAttemptState"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationAttemptState]] = Lazy(CurationAttemptState_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationAttemptState]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationAttemptState] = LazyInstance.value
  }
}