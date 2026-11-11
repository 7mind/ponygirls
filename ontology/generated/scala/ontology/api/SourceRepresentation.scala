import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait SourceRepresentation
  
  object SourceRepresentation extends BaboonEnum[SourceRepresentation] {
    case object Text extends SourceRepresentation
    case object PiTranscript extends SourceRepresentation
    case object HostReceipt extends SourceRepresentation
    case object GraphCommand extends SourceRepresentation
    case object HumanJudgment extends SourceRepresentation
    
    def parse(s: String): Option[SourceRepresentation] = {
      s match {
        case "Text" => Some(Text)
        case "PiTranscript" => Some(PiTranscript)
        case "HostReceipt" => Some(HostReceipt)
        case "GraphCommand" => Some(GraphCommand)
        case "HumanJudgment" => Some(HumanJudgment)
        case _ => None
      }
    }
    
    def all: List[SourceRepresentation] = List(
      Text,
      PiTranscript,
      HostReceipt,
      GraphCommand,
      HumanJudgment
    ) 
  }
  
  object SourceRepresentation_JsonCodec extends BaboonJsonCodec.Base[SourceRepresentation, BaboonJsonCodec[SourceRepresentation]] {
    def encode(ctx: BaboonCodecContext, value: SourceRepresentation): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SourceRepresentation] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          SourceRepresentation.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to SourceRepresentation: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to SourceRepresentation: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#SourceRepresentation"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SourceRepresentation]] = Lazy(SourceRepresentation_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SourceRepresentation]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SourceRepresentation] = LazyInstance.value
  }
}