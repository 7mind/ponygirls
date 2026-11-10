import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait Modality
  
  object Modality extends BaboonEnum[Modality] {
    case object Assertion extends Modality
    case object Prediction extends Modality
    case object Assumption extends Modality
    case object ObservationAccount extends Modality
    
    def parse(s: String): Option[Modality] = {
      s match {
        case "Assertion" => Some(Assertion)
        case "Prediction" => Some(Prediction)
        case "Assumption" => Some(Assumption)
        case "ObservationAccount" => Some(ObservationAccount)
        case _ => None
      }
    }
    
    def all: List[Modality] = List(
      Assertion,
      Prediction,
      Assumption,
      ObservationAccount
    ) 
  }
  
  object Modality_JsonCodec extends BaboonJsonCodec.Base[Modality, BaboonJsonCodec[Modality]] {
    def encode(ctx: BaboonCodecContext, value: Modality): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Modality] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Modality.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Modality: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Modality: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#Modality"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Modality]] = Lazy(Modality_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Modality]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Modality] = LazyInstance.value
  }
}