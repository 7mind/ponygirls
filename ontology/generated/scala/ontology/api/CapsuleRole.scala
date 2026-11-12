import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait CapsuleRole
  
  object CapsuleRole extends BaboonEnum[CapsuleRole] {
    case object RecordAccount extends CapsuleRole
    case object IntentAccount extends CapsuleRole
    case object HumanBasisAccount extends CapsuleRole
    case object DerivedAccount extends CapsuleRole
    case object Observation extends CapsuleRole
    case object Binding extends CapsuleRole
    case object Selection extends CapsuleRole
    case object Progress extends CapsuleRole
    case object Relation extends CapsuleRole
    case object SourceBasis extends CapsuleRole
    case object Artifact extends CapsuleRole
    case object Attribution extends CapsuleRole
    
    def parse(s: String): Option[CapsuleRole] = {
      s match {
        case "RecordAccount" => Some(RecordAccount)
        case "IntentAccount" => Some(IntentAccount)
        case "HumanBasisAccount" => Some(HumanBasisAccount)
        case "DerivedAccount" => Some(DerivedAccount)
        case "Observation" => Some(Observation)
        case "Binding" => Some(Binding)
        case "Selection" => Some(Selection)
        case "Progress" => Some(Progress)
        case "Relation" => Some(Relation)
        case "SourceBasis" => Some(SourceBasis)
        case "Artifact" => Some(Artifact)
        case "Attribution" => Some(Attribution)
        case _ => None
      }
    }
    
    def all: List[CapsuleRole] = List(
      RecordAccount,
      IntentAccount,
      HumanBasisAccount,
      DerivedAccount,
      Observation,
      Binding,
      Selection,
      Progress,
      Relation,
      SourceBasis,
      Artifact,
      Attribution
    ) 
  }
  
  object CapsuleRole_JsonCodec extends BaboonJsonCodec.Base[CapsuleRole, BaboonJsonCodec[CapsuleRole]] {
    def encode(ctx: BaboonCodecContext, value: CapsuleRole): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CapsuleRole] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          CapsuleRole.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CapsuleRole: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CapsuleRole: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#CapsuleRole"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CapsuleRole]] = Lazy(CapsuleRole_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CapsuleRole]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CapsuleRole] = LazyInstance.value
  }
}