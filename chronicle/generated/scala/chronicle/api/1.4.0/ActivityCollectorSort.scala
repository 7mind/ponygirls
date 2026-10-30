import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api.v1_4_0 {
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.8.0")
  sealed trait ActivityCollectorSort
  
  object ActivityCollectorSort extends BaboonEnum[ActivityCollectorSort] {
    case object CollectorId extends ActivityCollectorSort
    case object Phase extends ActivityCollectorSort
    case object Freshness extends ActivityCollectorSort
    case object ReceivedAt extends ActivityCollectorSort
    case object ArchiveHeads extends ActivityCollectorSort
    case object HeadsWithoutTargetJob extends ActivityCollectorSort
    case object CurrentTotal extends ActivityCollectorSort
    case object CurrentQueued extends ActivityCollectorSort
    case object CurrentRunning extends ActivityCollectorSort
    case object CurrentFailed extends ActivityCollectorSort
    case object CurrentComplete extends ActivityCollectorSort
    case object CurrentActiveRunning extends ActivityCollectorSort
    case object CurrentExpiredRunning extends ActivityCollectorSort
    case object CurrentUnleasedRunning extends ActivityCollectorSort
    case object HistoricalTotal extends ActivityCollectorSort
    case object HistoricalQueued extends ActivityCollectorSort
    case object HistoricalRunning extends ActivityCollectorSort
    case object HistoricalFailed extends ActivityCollectorSort
    case object HistoricalComplete extends ActivityCollectorSort
    case object HistoricalActiveRunning extends ActivityCollectorSort
    case object HistoricalExpiredRunning extends ActivityCollectorSort
    case object HistoricalUnleasedRunning extends ActivityCollectorSort
    
    def parse(s: String): Option[ActivityCollectorSort] = {
      s match {
        case "CollectorId" => Some(CollectorId)
        case "Phase" => Some(Phase)
        case "Freshness" => Some(Freshness)
        case "ReceivedAt" => Some(ReceivedAt)
        case "ArchiveHeads" => Some(ArchiveHeads)
        case "HeadsWithoutTargetJob" => Some(HeadsWithoutTargetJob)
        case "CurrentTotal" => Some(CurrentTotal)
        case "CurrentQueued" => Some(CurrentQueued)
        case "CurrentRunning" => Some(CurrentRunning)
        case "CurrentFailed" => Some(CurrentFailed)
        case "CurrentComplete" => Some(CurrentComplete)
        case "CurrentActiveRunning" => Some(CurrentActiveRunning)
        case "CurrentExpiredRunning" => Some(CurrentExpiredRunning)
        case "CurrentUnleasedRunning" => Some(CurrentUnleasedRunning)
        case "HistoricalTotal" => Some(HistoricalTotal)
        case "HistoricalQueued" => Some(HistoricalQueued)
        case "HistoricalRunning" => Some(HistoricalRunning)
        case "HistoricalFailed" => Some(HistoricalFailed)
        case "HistoricalComplete" => Some(HistoricalComplete)
        case "HistoricalActiveRunning" => Some(HistoricalActiveRunning)
        case "HistoricalExpiredRunning" => Some(HistoricalExpiredRunning)
        case "HistoricalUnleasedRunning" => Some(HistoricalUnleasedRunning)
        case _ => None
      }
    }
    
    def all: List[ActivityCollectorSort] = List(
      CollectorId,
      Phase,
      Freshness,
      ReceivedAt,
      ArchiveHeads,
      HeadsWithoutTargetJob,
      CurrentTotal,
      CurrentQueued,
      CurrentRunning,
      CurrentFailed,
      CurrentComplete,
      CurrentActiveRunning,
      CurrentExpiredRunning,
      CurrentUnleasedRunning,
      HistoricalTotal,
      HistoricalQueued,
      HistoricalRunning,
      HistoricalFailed,
      HistoricalComplete,
      HistoricalActiveRunning,
      HistoricalExpiredRunning,
      HistoricalUnleasedRunning
    ) 
  }
  
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.8.0")
  object ActivityCollectorSort_JsonCodec extends BaboonJsonCodec.Base[ActivityCollectorSort, BaboonJsonCodec[ActivityCollectorSort]] {
    def encode(ctx: BaboonCodecContext, value: ActivityCollectorSort): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityCollectorSort] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ActivityCollectorSort.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityCollectorSort: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityCollectorSort: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.4.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityCollectorSort"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityCollectorSort]] = Lazy(ActivityCollectorSort_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityCollectorSort]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityCollectorSort] = LazyInstance.value
  }
}