import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api.v1_5_0 {
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.8.0")
  sealed trait ModelRateBasis
  
  object ModelRateBasis extends BaboonEnum[ModelRateBasis] {
    case object ProviderReportedCompletedCalls extends ModelRateBasis
    
    def parse(s: String): Option[ModelRateBasis] = {
      s match {
        case "ProviderReportedCompletedCalls" => Some(ProviderReportedCompletedCalls)
        case _ => None
      }
    }
    
    def all: List[ModelRateBasis] = List(
      ProviderReportedCompletedCalls
    ) 
  }
  
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.8.0")
  object ModelRateBasis_JsonCodec extends BaboonJsonCodec.Base[ModelRateBasis, BaboonJsonCodec[ModelRateBasis]] {
    def encode(ctx: BaboonCodecContext, value: ModelRateBasis): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ModelRateBasis] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ModelRateBasis.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ModelRateBasis: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ModelRateBasis: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.5.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#ModelRateBasis"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ModelRateBasis]] = Lazy(ModelRateBasis_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ModelRateBasis]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ModelRateBasis] = LazyInstance.value
  }
}