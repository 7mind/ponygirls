import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait EventOrigin
  
  object EventOrigin extends BaboonEnum[EventOrigin] {
    case object UserMessage extends EventOrigin
    case object WorkerMessage extends EventOrigin
    case object ToolOutput extends EventOrigin
    case object GraphCommand extends EventOrigin
    
    def parse(s: String): Option[EventOrigin] = {
      s match {
        case "UserMessage" => Some(UserMessage)
        case "WorkerMessage" => Some(WorkerMessage)
        case "ToolOutput" => Some(ToolOutput)
        case "GraphCommand" => Some(GraphCommand)
        case _ => None
      }
    }
    
    def all: List[EventOrigin] = List(
      UserMessage,
      WorkerMessage,
      ToolOutput,
      GraphCommand
    ) 
  }
  
  object EventOrigin_JsonCodec extends BaboonJsonCodec.Base[EventOrigin, BaboonJsonCodec[EventOrigin]] {
    def encode(ctx: BaboonCodecContext, value: EventOrigin): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, EventOrigin] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          EventOrigin.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to EventOrigin: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to EventOrigin: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#EventOrigin"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[EventOrigin]] = Lazy(EventOrigin_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[EventOrigin]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[EventOrigin] = LazyInstance.value
  }
}