import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api.v1_1_0 {
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.8.0")
  sealed trait JobState
  
  object JobState extends BaboonEnum[JobState] {
    case object Queued extends JobState
    case object Running extends JobState
    case object Failed extends JobState
    case object Complete extends JobState
    
    def parse(s: String): Option[JobState] = {
      s match {
        case "Queued" => Some(Queued)
        case "Running" => Some(Running)
        case "Failed" => Some(Failed)
        case "Complete" => Some(Complete)
        case _ => None
      }
    }
    
    def all: List[JobState] = List(
      Queued,
      Running,
      Failed,
      Complete
    ) 
  }
  
  @deprecated("Version 1.1.0 is deprecated, you should migrate to 1.8.0")
  object JobState_JsonCodec extends BaboonJsonCodec.Base[JobState, BaboonJsonCodec[JobState]] {
    def encode(ctx: BaboonCodecContext, value: JobState): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, JobState] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          JobState.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to JobState: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to JobState: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.1.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#JobState"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[JobState]] = Lazy(JobState_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[JobState]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[JobState] = LazyInstance.value
  }
}