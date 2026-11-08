import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package rites.api {
  sealed trait ForgeKind
  
  object ForgeKind extends BaboonEnum[ForgeKind] {
    case object Github extends ForgeKind
    case object Gitlab extends ForgeKind
    
    def parse(s: String): Option[ForgeKind] = {
      s match {
        case "Github" => Some(Github)
        case "Gitlab" => Some(Gitlab)
        case _ => None
      }
    }
    
    def all: List[ForgeKind] = List(
      Github,
      Gitlab
    ) 
  }
  
  object ForgeKind_JsonCodec extends BaboonJsonCodec.Base[ForgeKind, BaboonJsonCodec[ForgeKind]] {
    def encode(ctx: BaboonCodecContext, value: ForgeKind): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ForgeKind] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ForgeKind.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ForgeKind: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ForgeKind: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.2.0"
    
    def baboonDomainIdentifier: String = "rites.api"
    
    def baboonTypeIdentifier: String = "rites.api/:#ForgeKind"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ForgeKind]] = Lazy(ForgeKind_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ForgeKind]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ForgeKind] = LazyInstance.value
  }
}