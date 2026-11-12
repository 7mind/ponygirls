import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait AssessmentUseDisposition
  
  object AssessmentUseDisposition extends BaboonEnum[AssessmentUseDisposition] {
    case object Applicable extends AssessmentUseDisposition
    case object Excluded extends AssessmentUseDisposition
    case object Unresolved extends AssessmentUseDisposition
    
    def parse(s: String): Option[AssessmentUseDisposition] = {
      s match {
        case "Applicable" => Some(Applicable)
        case "Excluded" => Some(Excluded)
        case "Unresolved" => Some(Unresolved)
        case _ => None
      }
    }
    
    def all: List[AssessmentUseDisposition] = List(
      Applicable,
      Excluded,
      Unresolved
    ) 
  }
  
  object AssessmentUseDisposition_JsonCodec extends BaboonJsonCodec.Base[AssessmentUseDisposition, BaboonJsonCodec[AssessmentUseDisposition]] {
    def encode(ctx: BaboonCodecContext, value: AssessmentUseDisposition): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, AssessmentUseDisposition] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          AssessmentUseDisposition.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to AssessmentUseDisposition: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to AssessmentUseDisposition: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#AssessmentUseDisposition"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[AssessmentUseDisposition]] = Lazy(AssessmentUseDisposition_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[AssessmentUseDisposition]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[AssessmentUseDisposition] = LazyInstance.value
  }
}