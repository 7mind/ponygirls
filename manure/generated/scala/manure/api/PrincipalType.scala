import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package manure.api {
  sealed trait PrincipalType
  
  object PrincipalType extends BaboonEnum[PrincipalType] {
    case object Human extends PrincipalType
    case object Agent extends PrincipalType
    
    def parse(s: String): Option[PrincipalType] = {
      s match {
        case "Human" => Some(Human)
        case "Agent" => Some(Agent)
        case _ => None
      }
    }
    
    def all: List[PrincipalType] = List(
      Human,
      Agent
    ) 
  }
  
  object PrincipalType_JsonCodec extends BaboonJsonCodec.Base[PrincipalType, BaboonJsonCodec[PrincipalType]] {
    def encode(ctx: BaboonCodecContext, value: PrincipalType): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PrincipalType] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          PrincipalType.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to PrincipalType: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to PrincipalType: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.0.0"
    
    def baboonDomainIdentifier: String = "manure.api"
    
    def baboonTypeIdentifier: String = "manure.api/:#PrincipalType"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PrincipalType]] = Lazy(PrincipalType_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PrincipalType]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PrincipalType] = LazyInstance.value
  }
}