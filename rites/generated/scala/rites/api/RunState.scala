import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package rites.api {
  sealed trait RunState
  
  object RunState extends BaboonEnum[RunState] {
    case object Queued extends RunState
    case object Running extends RunState
    case object NoChange extends RunState
    case object Published extends RunState
    case object Failed extends RunState
    case object PublicationUncertain extends RunState
    case object SupersessionPending extends RunState
    case object Cancelled extends RunState
    
    def parse(s: String): Option[RunState] = {
      s match {
        case "Queued" => Some(Queued)
        case "Running" => Some(Running)
        case "NoChange" => Some(NoChange)
        case "Published" => Some(Published)
        case "Failed" => Some(Failed)
        case "PublicationUncertain" => Some(PublicationUncertain)
        case "SupersessionPending" => Some(SupersessionPending)
        case "Cancelled" => Some(Cancelled)
        case _ => None
      }
    }
    
    def all: List[RunState] = List(
      Queued,
      Running,
      NoChange,
      Published,
      Failed,
      PublicationUncertain,
      SupersessionPending,
      Cancelled
    ) 
  }
  
  object RunState_JsonCodec extends BaboonJsonCodec.Base[RunState, BaboonJsonCodec[RunState]] {
    def encode(ctx: BaboonCodecContext, value: RunState): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RunState] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          RunState.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to RunState: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to RunState: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.2.0"
    
    def baboonDomainIdentifier: String = "rites.api"
    
    def baboonTypeIdentifier: String = "rites.api/:#RunState"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RunState]] = Lazy(RunState_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RunState]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RunState] = LazyInstance.value
  }
}