import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait Correction
  
  object Correction extends BaboonEnum[Correction] {
    case object Implementation extends Correction
    case object Interpretation extends Correction
    case object IntentChange extends Correction
    case object Mixed extends Correction
    case object Unresolved extends Correction
    
    def parse(s: String): Option[Correction] = {
      s match {
        case "Implementation" => Some(Implementation)
        case "Interpretation" => Some(Interpretation)
        case "IntentChange" => Some(IntentChange)
        case "Mixed" => Some(Mixed)
        case "Unresolved" => Some(Unresolved)
        case _ => None
      }
    }
    
    def all: List[Correction] = List(
      Implementation,
      Interpretation,
      IntentChange,
      Mixed,
      Unresolved
    ) 
  }
  
  object Correction_JsonCodec extends BaboonJsonCodec.Base[Correction, BaboonJsonCodec[Correction]] {
    def encode(ctx: BaboonCodecContext, value: Correction): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Correction] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Correction.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Correction: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Correction: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#Correction"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Correction]] = Lazy(Correction_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Correction]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Correction] = LazyInstance.value
  }
}