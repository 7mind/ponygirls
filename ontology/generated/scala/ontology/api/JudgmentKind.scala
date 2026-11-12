import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait JudgmentKind
  
  object JudgmentKind extends BaboonEnum[JudgmentKind] {
    case object Accept extends JudgmentKind
    case object RequestCorrection extends JudgmentKind
    case object NeedEvidence extends JudgmentKind
    case object ReviseIntent extends JudgmentKind
    
    def parse(s: String): Option[JudgmentKind] = {
      s match {
        case "Accept" => Some(Accept)
        case "RequestCorrection" => Some(RequestCorrection)
        case "NeedEvidence" => Some(NeedEvidence)
        case "ReviseIntent" => Some(ReviseIntent)
        case _ => None
      }
    }
    
    def all: List[JudgmentKind] = List(
      Accept,
      RequestCorrection,
      NeedEvidence,
      ReviseIntent
    ) 
  }
  
  object JudgmentKind_JsonCodec extends BaboonJsonCodec.Base[JudgmentKind, BaboonJsonCodec[JudgmentKind]] {
    def encode(ctx: BaboonCodecContext, value: JudgmentKind): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, JudgmentKind] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          JudgmentKind.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to JudgmentKind: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to JudgmentKind: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#JudgmentKind"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[JudgmentKind]] = Lazy(JudgmentKind_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[JudgmentKind]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[JudgmentKind] = LazyInstance.value
  }
}