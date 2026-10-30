import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api.v1_6_0 {
  @deprecated("Version 1.6.0 is deprecated, you should migrate to 1.8.0")
  sealed trait PassageFormat
  
  object PassageFormat extends BaboonEnum[PassageFormat] {
    case object Unindexed extends PassageFormat
    case object LegacyAnnotations extends PassageFormat
    case object ContiguousProblems extends PassageFormat
    
    def parse(s: String): Option[PassageFormat] = {
      s match {
        case "Unindexed" => Some(Unindexed)
        case "LegacyAnnotations" => Some(LegacyAnnotations)
        case "ContiguousProblems" => Some(ContiguousProblems)
        case _ => None
      }
    }
    
    def all: List[PassageFormat] = List(
      Unindexed,
      LegacyAnnotations,
      ContiguousProblems
    ) 
  }
  
  @deprecated("Version 1.6.0 is deprecated, you should migrate to 1.8.0")
  object PassageFormat_JsonCodec extends BaboonJsonCodec.Base[PassageFormat, BaboonJsonCodec[PassageFormat]] {
    def encode(ctx: BaboonCodecContext, value: PassageFormat): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PassageFormat] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          PassageFormat.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to PassageFormat: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to PassageFormat: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.6.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#PassageFormat"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PassageFormat]] = Lazy(PassageFormat_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PassageFormat]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PassageFormat] = LazyInstance.value
  }
}