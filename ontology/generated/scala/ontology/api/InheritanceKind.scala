import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait InheritanceKind
  
  object InheritanceKind extends BaboonEnum[InheritanceKind] {
    case object Fork extends InheritanceKind
    case object Import extends InheritanceKind
    
    def parse(s: String): Option[InheritanceKind] = {
      s match {
        case "Fork" => Some(Fork)
        case "Import" => Some(Import)
        case _ => None
      }
    }
    
    def all: List[InheritanceKind] = List(
      Fork,
      Import
    ) 
  }
  
  object InheritanceKind_JsonCodec extends BaboonJsonCodec.Base[InheritanceKind, BaboonJsonCodec[InheritanceKind]] {
    def encode(ctx: BaboonCodecContext, value: InheritanceKind): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, InheritanceKind] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          InheritanceKind.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to InheritanceKind: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to InheritanceKind: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#InheritanceKind"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[InheritanceKind]] = Lazy(InheritanceKind_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[InheritanceKind]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[InheritanceKind] = LazyInstance.value
  }
}