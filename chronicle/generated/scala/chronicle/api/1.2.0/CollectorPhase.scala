import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api.v1_2_0 {
  @deprecated("Version 1.2.0 is deprecated, you should migrate to 1.7.0")
  sealed trait CollectorPhase
  
  object CollectorPhase extends BaboonEnum[CollectorPhase] {
    case object Discovering extends CollectorPhase
    case object Scanning extends CollectorPhase
    case object Uploading extends CollectorPhase
    case object Idle extends CollectorPhase
    case object Failed extends CollectorPhase
    
    def parse(s: String): Option[CollectorPhase] = {
      s match {
        case "Discovering" => Some(Discovering)
        case "Scanning" => Some(Scanning)
        case "Uploading" => Some(Uploading)
        case "Idle" => Some(Idle)
        case "Failed" => Some(Failed)
        case _ => None
      }
    }
    
    def all: List[CollectorPhase] = List(
      Discovering,
      Scanning,
      Uploading,
      Idle,
      Failed
    ) 
  }
  
  @deprecated("Version 1.2.0 is deprecated, you should migrate to 1.7.0")
  object CollectorPhase_JsonCodec extends BaboonJsonCodec.Base[CollectorPhase, BaboonJsonCodec[CollectorPhase]] {
    def encode(ctx: BaboonCodecContext, value: CollectorPhase): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CollectorPhase] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          CollectorPhase.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CollectorPhase: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CollectorPhase: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.2.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#CollectorPhase"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CollectorPhase]] = Lazy(CollectorPhase_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CollectorPhase]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CollectorPhase] = LazyInstance.value
  }
}