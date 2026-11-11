import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait Capability
  
  object Capability extends BaboonEnum[Capability] {
    case object Read extends Capability
    case object Mutate extends Capability
    case object Capture extends Capability
    case object Review extends Capability
    case object HostCapture extends Capability
    
    def parse(s: String): Option[Capability] = {
      s match {
        case "Read" => Some(Read)
        case "Mutate" => Some(Mutate)
        case "Capture" => Some(Capture)
        case "Review" => Some(Review)
        case "HostCapture" => Some(HostCapture)
        case _ => None
      }
    }
    
    def all: List[Capability] = List(
      Read,
      Mutate,
      Capture,
      Review,
      HostCapture
    ) 
  }
  
  object Capability_JsonCodec extends BaboonJsonCodec.Base[Capability, BaboonJsonCodec[Capability]] {
    def encode(ctx: BaboonCodecContext, value: Capability): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Capability] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          Capability.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Capability: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to Capability: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#Capability"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Capability]] = Lazy(Capability_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Capability]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Capability] = LazyInstance.value
  }
}