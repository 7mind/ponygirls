import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api {
  sealed trait UploadPhase
  
  object UploadPhase extends BaboonEnum[UploadPhase] {
    case object Open extends UploadPhase
    case object Committed extends UploadPhase
    case object Aborted extends UploadPhase
    case object Expired extends UploadPhase
    case object Failed extends UploadPhase
    
    def parse(s: String): Option[UploadPhase] = {
      s match {
        case "Open" => Some(Open)
        case "Committed" => Some(Committed)
        case "Aborted" => Some(Aborted)
        case "Expired" => Some(Expired)
        case "Failed" => Some(Failed)
        case _ => None
      }
    }
    
    def all: List[UploadPhase] = List(
      Open,
      Committed,
      Aborted,
      Expired,
      Failed
    ) 
  }
  
  object UploadPhase_JsonCodec extends BaboonJsonCodec.Base[UploadPhase, BaboonJsonCodec[UploadPhase]] {
    def encode(ctx: BaboonCodecContext, value: UploadPhase): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, UploadPhase] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          UploadPhase.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to UploadPhase: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to UploadPhase: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.9.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#UploadPhase"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[UploadPhase]] = Lazy(UploadPhase_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[UploadPhase]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[UploadPhase] = LazyInstance.value
  }
}