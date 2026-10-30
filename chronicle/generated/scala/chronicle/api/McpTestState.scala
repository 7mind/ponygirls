import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api {
  sealed trait McpTestState
  
  object McpTestState extends BaboonEnum[McpTestState] {
    case object Queued extends McpTestState
    case object Running extends McpTestState
    case object Complete extends McpTestState
    case object Failed extends McpTestState
    case object Cancelled extends McpTestState
    case object AuthorizationLost extends McpTestState
    case object Expired extends McpTestState
    
    def parse(s: String): Option[McpTestState] = {
      s match {
        case "Queued" => Some(Queued)
        case "Running" => Some(Running)
        case "Complete" => Some(Complete)
        case "Failed" => Some(Failed)
        case "Cancelled" => Some(Cancelled)
        case "AuthorizationLost" => Some(AuthorizationLost)
        case "Expired" => Some(Expired)
        case _ => None
      }
    }
    
    def all: List[McpTestState] = List(
      Queued,
      Running,
      Complete,
      Failed,
      Cancelled,
      AuthorizationLost,
      Expired
    ) 
  }
  
  object McpTestState_JsonCodec extends BaboonJsonCodec.Base[McpTestState, BaboonJsonCodec[McpTestState]] {
    def encode(ctx: BaboonCodecContext, value: McpTestState): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, McpTestState] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          McpTestState.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to McpTestState: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to McpTestState: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.9.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#McpTestState"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[McpTestState]] = Lazy(McpTestState_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[McpTestState]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[McpTestState] = LazyInstance.value
  }
}