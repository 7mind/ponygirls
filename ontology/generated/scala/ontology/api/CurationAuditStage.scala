import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait CurationAuditStage
  
  object CurationAuditStage extends BaboonEnum[CurationAuditStage] {
    case object RequestPrepared extends CurationAuditStage
    case object DispatchPossible extends CurationAuditStage
    case object ResponseObserved extends CurationAuditStage
    
    def parse(s: String): Option[CurationAuditStage] = {
      s match {
        case "RequestPrepared" => Some(RequestPrepared)
        case "DispatchPossible" => Some(DispatchPossible)
        case "ResponseObserved" => Some(ResponseObserved)
        case _ => None
      }
    }
    
    def all: List[CurationAuditStage] = List(
      RequestPrepared,
      DispatchPossible,
      ResponseObserved
    ) 
  }
  
  object CurationAuditStage_JsonCodec extends BaboonJsonCodec.Base[CurationAuditStage, BaboonJsonCodec[CurationAuditStage]] {
    def encode(ctx: BaboonCodecContext, value: CurationAuditStage): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CurationAuditStage] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          CurationAuditStage.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CurationAuditStage: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CurationAuditStage: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#CurationAuditStage"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CurationAuditStage]] = Lazy(CurationAuditStage_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CurationAuditStage]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CurationAuditStage] = LazyInstance.value
  }
}