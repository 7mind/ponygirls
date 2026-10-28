import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api {
  sealed trait ActivityJobClass
  
  object ActivityJobClass extends BaboonEnum[ActivityJobClass] {
    case object Current extends ActivityJobClass
    case object SupersededRevision extends ActivityJobClass
    case object ObsoleteProfile extends ActivityJobClass
    case object SupersededRevisionAndProfile extends ActivityJobClass
    
    def parse(s: String): Option[ActivityJobClass] = {
      s match {
        case "Current" => Some(Current)
        case "SupersededRevision" => Some(SupersededRevision)
        case "ObsoleteProfile" => Some(ObsoleteProfile)
        case "SupersededRevisionAndProfile" => Some(SupersededRevisionAndProfile)
        case _ => None
      }
    }
    
    def all: List[ActivityJobClass] = List(
      Current,
      SupersededRevision,
      ObsoleteProfile,
      SupersededRevisionAndProfile
    ) 
  }
  
  object ActivityJobClass_JsonCodec extends BaboonJsonCodec.Base[ActivityJobClass, BaboonJsonCodec[ActivityJobClass]] {
    def encode(ctx: BaboonCodecContext, value: ActivityJobClass): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobClass] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ActivityJobClass.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityJobClass: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityJobClass: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.7.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityJobClass"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobClass]] = Lazy(ActivityJobClass_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobClass]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityJobClass] = LazyInstance.value
  }
}