import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait InputKind
  
  object InputKind extends BaboonEnum[InputKind] {
    case object GraphMutation extends InputKind
    case object Capture extends InputKind
    case object Curation extends InputKind
    case object PresentationPublication extends InputKind
    case object Judgment extends InputKind
    
    def parse(s: String): Option[InputKind] = {
      s match {
        case "GraphMutation" => Some(GraphMutation)
        case "Capture" => Some(Capture)
        case "Curation" => Some(Curation)
        case "PresentationPublication" => Some(PresentationPublication)
        case "Judgment" => Some(Judgment)
        case _ => None
      }
    }
    
    def all: List[InputKind] = List(
      GraphMutation,
      Capture,
      Curation,
      PresentationPublication,
      Judgment
    ) 
  }
  
  object InputKind_JsonCodec extends BaboonJsonCodec.Base[InputKind, BaboonJsonCodec[InputKind]] {
    def encode(ctx: BaboonCodecContext, value: InputKind): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, InputKind] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          InputKind.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to InputKind: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to InputKind: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#InputKind"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[InputKind]] = Lazy(InputKind_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[InputKind]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[InputKind] = LazyInstance.value
  }
}