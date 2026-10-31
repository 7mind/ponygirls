import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api {
  sealed trait ArchiveMatchKind
  
  object ArchiveMatchKind extends BaboonEnum[ArchiveMatchKind] {
    case object Literal extends ArchiveMatchKind
    case object Semantic extends ArchiveMatchKind
    
    def parse(s: String): Option[ArchiveMatchKind] = {
      s match {
        case "Literal" => Some(Literal)
        case "Semantic" => Some(Semantic)
        case _ => None
      }
    }
    
    def all: List[ArchiveMatchKind] = List(
      Literal,
      Semantic
    ) 
  }
  
  object ArchiveMatchKind_JsonCodec extends BaboonJsonCodec.Base[ArchiveMatchKind, BaboonJsonCodec[ArchiveMatchKind]] {
    def encode(ctx: BaboonCodecContext, value: ArchiveMatchKind): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ArchiveMatchKind] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ArchiveMatchKind.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ArchiveMatchKind: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ArchiveMatchKind: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.9.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#ArchiveMatchKind"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ArchiveMatchKind]] = Lazy(ArchiveMatchKind_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ArchiveMatchKind]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ArchiveMatchKind] = LazyInstance.value
  }
}