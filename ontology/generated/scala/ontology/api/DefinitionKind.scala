import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait DefinitionKind
  
  object DefinitionKind extends BaboonEnum[DefinitionKind] {
    case object Outcome extends DefinitionKind
    case object Constraint extends DefinitionKind
    case object Task extends DefinitionKind
    case object Statement extends DefinitionKind
    case object Hypothesis extends DefinitionKind
    case object Defect extends DefinitionKind
    case object Question extends DefinitionKind
    case object Decision extends DefinitionKind
    case object Review extends DefinitionKind
    case object Source extends DefinitionKind
    case object Artifact extends DefinitionKind
    case object Conflict extends DefinitionKind
    
    def parse(s: String): Option[DefinitionKind] = {
      s match {
        case "Outcome" => Some(Outcome)
        case "Constraint" => Some(Constraint)
        case "Task" => Some(Task)
        case "Statement" => Some(Statement)
        case "Hypothesis" => Some(Hypothesis)
        case "Defect" => Some(Defect)
        case "Question" => Some(Question)
        case "Decision" => Some(Decision)
        case "Review" => Some(Review)
        case "Source" => Some(Source)
        case "Artifact" => Some(Artifact)
        case "Conflict" => Some(Conflict)
        case _ => None
      }
    }
    
    def all: List[DefinitionKind] = List(
      Outcome,
      Constraint,
      Task,
      Statement,
      Hypothesis,
      Defect,
      Question,
      Decision,
      Review,
      Source,
      Artifact,
      Conflict
    ) 
  }
  
  object DefinitionKind_JsonCodec extends BaboonJsonCodec.Base[DefinitionKind, BaboonJsonCodec[DefinitionKind]] {
    def encode(ctx: BaboonCodecContext, value: DefinitionKind): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, DefinitionKind] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          DefinitionKind.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to DefinitionKind: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to DefinitionKind: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#DefinitionKind"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[DefinitionKind]] = Lazy(DefinitionKind_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[DefinitionKind]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[DefinitionKind] = LazyInstance.value
  }
}