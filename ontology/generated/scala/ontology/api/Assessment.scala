import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait Assessment
  
  object Assessment extends BaboonEnum[Assessment] {
    case object Unassessed extends Assessment
    case object Supported extends Assessment
    case object Contradicted extends Assessment
    case object Mixed extends Assessment
    
    def parse(s: String): Option[Assessment] = {
      s match {
        case "Unassessed" => Some(Unassessed)
        case "Supported" => Some(Supported)
        case "Contradicted" => Some(Contradicted)
        case "Mixed" => Some(Mixed)
        case _ => None
      }
    }
    
    def all: List[Assessment] = List(
      Unassessed,
      Supported,
      Contradicted,
      Mixed
    ) 
  }
  
  object Assessment_JsonCodec extends BaboonJsonCodec.Base[Assessment, BaboonJsonCodec[Assessment]] {
    def encode(ctx: BaboonCodecContext, value: Assessment): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Assessment] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Assessment.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Assessment: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Assessment: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#Assessment"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Assessment]] = Lazy(Assessment_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Assessment]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Assessment] = LazyInstance.value
  }
}