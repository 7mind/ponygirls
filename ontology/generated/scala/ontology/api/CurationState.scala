import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait CurationState
  
  object CurationState extends BaboonEnum[CurationState] {
    case object Idle extends CurationState
    case object Pending extends CurationState
    case object Running extends CurationState
    case object Failed extends CurationState
    case object Stale extends CurationState
    case object Interrupted extends CurationState
    
    def parse(s: String): Option[CurationState] = {
      s match {
        case "Idle" => Some(Idle)
        case "Pending" => Some(Pending)
        case "Running" => Some(Running)
        case "Failed" => Some(Failed)
        case "Stale" => Some(Stale)
        case "Interrupted" => Some(Interrupted)
        case _ => None
      }
    }
    
    def all: List[CurationState] = List(
      Idle,
      Pending,
      Running,
      Failed,
      Stale,
      Interrupted
    ) 
  }
  
  object CurationState_JsonCodec extends BaboonJsonCodec.Base[CurationState, BaboonJsonCodec[CurationState]] {
    def encode(ctx: BaboonCodecContext, value: CurationState): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationState] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          CurationState.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CurationState: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CurationState: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#CurationState"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationState]] = Lazy(CurationState_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationState]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationState] = LazyInstance.value
  }
}