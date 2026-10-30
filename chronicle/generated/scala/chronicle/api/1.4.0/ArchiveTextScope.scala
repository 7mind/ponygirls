import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api.v1_4_0 {
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.8.0")
  sealed trait ArchiveTextScope
  
  object ArchiveTextScope extends BaboonEnum[ArchiveTextScope] {
    case object ExactLexical extends ArchiveTextScope
    case object BoundedCandidateSets extends ArchiveTextScope
    
    def parse(s: String): Option[ArchiveTextScope] = {
      s match {
        case "ExactLexical" => Some(ExactLexical)
        case "BoundedCandidateSets" => Some(BoundedCandidateSets)
        case _ => None
      }
    }
    
    def all: List[ArchiveTextScope] = List(
      ExactLexical,
      BoundedCandidateSets
    ) 
  }
  
  @deprecated("Version 1.4.0 is deprecated, you should migrate to 1.8.0")
  object ArchiveTextScope_JsonCodec extends BaboonJsonCodec.Base[ArchiveTextScope, BaboonJsonCodec[ArchiveTextScope]] {
    def encode(ctx: BaboonCodecContext, value: ArchiveTextScope): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ArchiveTextScope] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ArchiveTextScope.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ArchiveTextScope: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ArchiveTextScope: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.4.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#ArchiveTextScope"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ArchiveTextScope]] = Lazy(ArchiveTextScope_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ArchiveTextScope]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ArchiveTextScope] = LazyInstance.value
  }
}