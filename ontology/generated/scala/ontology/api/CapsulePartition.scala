import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait CapsulePartition
  
  object CapsulePartition extends BaboonEnum[CapsulePartition] {
    case object SelectedWorkContext extends CapsulePartition
    case object UnresolvedScopeContext extends CapsulePartition
    case object SupportingContext extends CapsulePartition
    case object HistoricalContext extends CapsulePartition
    
    def parse(s: String): Option[CapsulePartition] = {
      s match {
        case "SelectedWorkContext" => Some(SelectedWorkContext)
        case "UnresolvedScopeContext" => Some(UnresolvedScopeContext)
        case "SupportingContext" => Some(SupportingContext)
        case "HistoricalContext" => Some(HistoricalContext)
        case _ => None
      }
    }
    
    def all: List[CapsulePartition] = List(
      SelectedWorkContext,
      UnresolvedScopeContext,
      SupportingContext,
      HistoricalContext
    ) 
  }
  
  object CapsulePartition_JsonCodec extends BaboonJsonCodec.Base[CapsulePartition, BaboonJsonCodec[CapsulePartition]] {
    def encode(ctx: BaboonCodecContext, value: CapsulePartition): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CapsulePartition] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          CapsulePartition.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CapsulePartition: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CapsulePartition: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#CapsulePartition"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CapsulePartition]] = Lazy(CapsulePartition_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CapsulePartition]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CapsulePartition] = LazyInstance.value
  }
}