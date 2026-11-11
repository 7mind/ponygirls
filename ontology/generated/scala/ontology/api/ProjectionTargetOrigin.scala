import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait ProjectionTargetOrigin
  
  object ProjectionTargetOrigin extends BaboonEnum[ProjectionTargetOrigin] {
    case object Head extends ProjectionTargetOrigin
    case object Outbox extends ProjectionTargetOrigin
    
    def parse(s: String): Option[ProjectionTargetOrigin] = {
      s match {
        case "Head" => Some(Head)
        case "Outbox" => Some(Outbox)
        case _ => None
      }
    }
    
    def all: List[ProjectionTargetOrigin] = List(
      Head,
      Outbox
    ) 
  }
  
  object ProjectionTargetOrigin_JsonCodec extends BaboonJsonCodec.Base[ProjectionTargetOrigin, BaboonJsonCodec[ProjectionTargetOrigin]] {
    def encode(ctx: BaboonCodecContext, value: ProjectionTargetOrigin): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ProjectionTargetOrigin] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ProjectionTargetOrigin.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ProjectionTargetOrigin: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ProjectionTargetOrigin: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#ProjectionTargetOrigin"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ProjectionTargetOrigin]] = Lazy(ProjectionTargetOrigin_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ProjectionTargetOrigin]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ProjectionTargetOrigin] = LazyInstance.value
  }
}