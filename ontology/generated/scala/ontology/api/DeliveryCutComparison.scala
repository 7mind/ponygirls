import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait DeliveryCutComparison
  
  object DeliveryCutComparison extends BaboonEnum[DeliveryCutComparison] {
    case object SameGraphAndCoverage extends DeliveryCutComparison
    case object ChangedGraphOrCoverage extends DeliveryCutComparison
    
    def parse(s: String): Option[DeliveryCutComparison] = {
      s match {
        case "SameGraphAndCoverage" => Some(SameGraphAndCoverage)
        case "ChangedGraphOrCoverage" => Some(ChangedGraphOrCoverage)
        case _ => None
      }
    }
    
    def all: List[DeliveryCutComparison] = List(
      SameGraphAndCoverage,
      ChangedGraphOrCoverage
    ) 
  }
  
  object DeliveryCutComparison_JsonCodec extends BaboonJsonCodec.Base[DeliveryCutComparison, BaboonJsonCodec[DeliveryCutComparison]] {
    def encode(ctx: BaboonCodecContext, value: DeliveryCutComparison): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, DeliveryCutComparison] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          DeliveryCutComparison.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to DeliveryCutComparison: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to DeliveryCutComparison: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#DeliveryCutComparison"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[DeliveryCutComparison]] = Lazy(DeliveryCutComparison_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[DeliveryCutComparison]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[DeliveryCutComparison] = LazyInstance.value
  }
}