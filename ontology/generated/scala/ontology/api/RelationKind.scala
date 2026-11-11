import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait RelationKind
  
  object RelationKind extends BaboonEnum[RelationKind] {
    case object Quotes extends RelationKind
    case object Interprets extends RelationKind
    case object Infers extends RelationKind
    case object Assumes extends RelationKind
    case object Supports extends RelationKind
    case object Challenges extends RelationKind
    case object Adopts extends RelationKind
    case object Chooses extends RelationKind
    case object Delegates extends RelationKind
    case object Supersedes extends RelationKind
    case object Withdraws extends RelationKind
    case object ContributesTo extends RelationKind
    case object DependsOn extends RelationKind
    case object Requires extends RelationKind
    case object Decomposes extends RelationKind
    case object AssignedTo extends RelationKind
    case object PlannedOutput extends RelationKind
    case object Produced extends RelationKind
    case object Answers extends RelationKind
    case object Assesses extends RelationKind
    case object UsesAssessment extends RelationKind
    
    def parse(s: String): Option[RelationKind] = {
      s match {
        case "Quotes" => Some(Quotes)
        case "Interprets" => Some(Interprets)
        case "Infers" => Some(Infers)
        case "Assumes" => Some(Assumes)
        case "Supports" => Some(Supports)
        case "Challenges" => Some(Challenges)
        case "Adopts" => Some(Adopts)
        case "Chooses" => Some(Chooses)
        case "Delegates" => Some(Delegates)
        case "Supersedes" => Some(Supersedes)
        case "Withdraws" => Some(Withdraws)
        case "ContributesTo" => Some(ContributesTo)
        case "DependsOn" => Some(DependsOn)
        case "Requires" => Some(Requires)
        case "Decomposes" => Some(Decomposes)
        case "AssignedTo" => Some(AssignedTo)
        case "PlannedOutput" => Some(PlannedOutput)
        case "Produced" => Some(Produced)
        case "Answers" => Some(Answers)
        case "Assesses" => Some(Assesses)
        case "UsesAssessment" => Some(UsesAssessment)
        case _ => None
      }
    }
    
    def all: List[RelationKind] = List(
      Quotes,
      Interprets,
      Infers,
      Assumes,
      Supports,
      Challenges,
      Adopts,
      Chooses,
      Delegates,
      Supersedes,
      Withdraws,
      ContributesTo,
      DependsOn,
      Requires,
      Decomposes,
      AssignedTo,
      PlannedOutput,
      Produced,
      Answers,
      Assesses,
      UsesAssessment
    ) 
  }
  
  object RelationKind_JsonCodec extends BaboonJsonCodec.Base[RelationKind, BaboonJsonCodec[RelationKind]] {
    def encode(ctx: BaboonCodecContext, value: RelationKind): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationKind] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          RelationKind.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to RelationKind: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to RelationKind: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#RelationKind"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationKind]] = Lazy(RelationKind_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationKind]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RelationKind] = LazyInstance.value
  }
}