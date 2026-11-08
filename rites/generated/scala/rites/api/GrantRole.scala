import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package rites.api {
  sealed trait GrantRole
  
  object GrantRole extends BaboonEnum[GrantRole] {
    case object Owner extends GrantRole
    case object Editor extends GrantRole
    case object Viewer extends GrantRole
    
    def parse(s: String): Option[GrantRole] = {
      s match {
        case "Owner" => Some(Owner)
        case "Editor" => Some(Editor)
        case "Viewer" => Some(Viewer)
        case _ => None
      }
    }
    
    def all: List[GrantRole] = List(
      Owner,
      Editor,
      Viewer
    ) 
  }
  
  object GrantRole_JsonCodec extends BaboonJsonCodec.Base[GrantRole, BaboonJsonCodec[GrantRole]] {
    def encode(ctx: BaboonCodecContext, value: GrantRole): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GrantRole] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          GrantRole.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to GrantRole: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to GrantRole: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.2.0"
    
    def baboonDomainIdentifier: String = "rites.api"
    
    def baboonTypeIdentifier: String = "rites.api/:#GrantRole"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GrantRole]] = Lazy(GrantRole_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[GrantRole]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[GrantRole] = LazyInstance.value
  }
}