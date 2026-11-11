import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait CapsuleQualificationCode
  
  object CapsuleQualificationCode extends BaboonEnum[CapsuleQualificationCode] {
    case object CoverageLag extends CapsuleQualificationCode
    case object NoCurationPublication extends CapsuleQualificationCode
    case object GraphChangedAfterCuration extends CapsuleQualificationCode
    case object ReportedContextUnknown extends CapsuleQualificationCode
    case object UnresolvedApplicability extends CapsuleQualificationCode
    case object UnboundIntent extends CapsuleQualificationCode
    case object StaleBinding extends CapsuleQualificationCode
    case object StaleWarrant extends CapsuleQualificationCode
    case object MissingHumanBasis extends CapsuleQualificationCode
    case object AmbiguousHumanBasis extends CapsuleQualificationCode
    case object UnresolvedConflict extends CapsuleQualificationCode
    case object UnresolvedChange extends CapsuleQualificationCode
    case object HistoricalEvidence extends CapsuleQualificationCode
    
    def parse(s: String): Option[CapsuleQualificationCode] = {
      s match {
        case "CoverageLag" => Some(CoverageLag)
        case "NoCurationPublication" => Some(NoCurationPublication)
        case "GraphChangedAfterCuration" => Some(GraphChangedAfterCuration)
        case "ReportedContextUnknown" => Some(ReportedContextUnknown)
        case "UnresolvedApplicability" => Some(UnresolvedApplicability)
        case "UnboundIntent" => Some(UnboundIntent)
        case "StaleBinding" => Some(StaleBinding)
        case "StaleWarrant" => Some(StaleWarrant)
        case "MissingHumanBasis" => Some(MissingHumanBasis)
        case "AmbiguousHumanBasis" => Some(AmbiguousHumanBasis)
        case "UnresolvedConflict" => Some(UnresolvedConflict)
        case "UnresolvedChange" => Some(UnresolvedChange)
        case "HistoricalEvidence" => Some(HistoricalEvidence)
        case _ => None
      }
    }
    
    def all: List[CapsuleQualificationCode] = List(
      CoverageLag,
      NoCurationPublication,
      GraphChangedAfterCuration,
      ReportedContextUnknown,
      UnresolvedApplicability,
      UnboundIntent,
      StaleBinding,
      StaleWarrant,
      MissingHumanBasis,
      AmbiguousHumanBasis,
      UnresolvedConflict,
      UnresolvedChange,
      HistoricalEvidence
    ) 
  }
  
  object CapsuleQualificationCode_JsonCodec extends BaboonJsonCodec.Base[CapsuleQualificationCode, BaboonJsonCodec[CapsuleQualificationCode]] {
    def encode(ctx: BaboonCodecContext, value: CapsuleQualificationCode): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CapsuleQualificationCode] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          CapsuleQualificationCode.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CapsuleQualificationCode: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CapsuleQualificationCode: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#CapsuleQualificationCode"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CapsuleQualificationCode]] = Lazy(CapsuleQualificationCode_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CapsuleQualificationCode]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CapsuleQualificationCode] = LazyInstance.value
  }
}