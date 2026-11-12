import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait Execution
  
  object Execution extends BaboonEnum[Execution] {
    case object Delegated extends Execution
    case object HumanRequired extends Execution
    
    def parse(s: String): Option[Execution] = {
      s match {
        case "Delegated" => Some(Delegated)
        case "HumanRequired" => Some(HumanRequired)
        case _ => None
      }
    }
    
    def all: List[Execution] = List(
      Delegated,
      HumanRequired
    ) 
  }
  
  object Execution_JsonCodec extends BaboonJsonCodec.Base[Execution, BaboonJsonCodec[Execution]] {
    def encode(ctx: BaboonCodecContext, value: Execution): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Execution] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Execution.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Execution: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Execution: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#Execution"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Execution]] = Lazy(Execution_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Execution]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Execution] = LazyInstance.value
  }
}