import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api.v1_4_0 {
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.5.0")
  sealed trait ActivityJobSort
  
  object ActivityJobSort extends BaboonEnum[ActivityJobSort] {
    case object LastTimestamp extends ActivityJobSort
    case object Title extends ActivityJobSort
    case object Collector extends ActivityJobSort
    case object State extends ActivityJobSort
    case object Revision extends ActivityJobSort
    case object Profile extends ActivityJobSort
    case object Attempts extends ActivityJobSort
    case object CompletedWindows extends ActivityJobSort
    case object TotalWindows extends ActivityJobSort
    case object LeaseExpiresAt extends ActivityJobSort
    case object LeaseState extends ActivityJobSort
    case object Reason extends ActivityJobSort
    case object Classification extends ActivityJobSort
    case object JobId extends ActivityJobSort
    case object SessionId extends ActivityJobSort
    
    def parse(s: String): Option[ActivityJobSort] = {
      s match {
        case "LastTimestamp" => Some(LastTimestamp)
        case "Title" => Some(Title)
        case "Collector" => Some(Collector)
        case "State" => Some(State)
        case "Revision" => Some(Revision)
        case "Profile" => Some(Profile)
        case "Attempts" => Some(Attempts)
        case "CompletedWindows" => Some(CompletedWindows)
        case "TotalWindows" => Some(TotalWindows)
        case "LeaseExpiresAt" => Some(LeaseExpiresAt)
        case "LeaseState" => Some(LeaseState)
        case "Reason" => Some(Reason)
        case "Classification" => Some(Classification)
        case "JobId" => Some(JobId)
        case "SessionId" => Some(SessionId)
        case _ => None
      }
    }
    
    def all: List[ActivityJobSort] = List(
      LastTimestamp,
      Title,
      Collector,
      State,
      Revision,
      Profile,
      Attempts,
      CompletedWindows,
      TotalWindows,
      LeaseExpiresAt,
      LeaseState,
      Reason,
      Classification,
      JobId,
      SessionId
    ) 
  }
  
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.5.0")
  object ActivityJobSort_JsonCodec extends BaboonJsonCodec.Base[ActivityJobSort, BaboonJsonCodec[ActivityJobSort]] {
    def encode(ctx: BaboonCodecContext, value: ActivityJobSort): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobSort] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ActivityJobSort.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityJobSort: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityJobSort: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.4.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityJobSort"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobSort]] = Lazy(ActivityJobSort_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobSort]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityJobSort] = LazyInstance.value
  }
}