import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait LineageStatus
  
  object LineageStatus extends BaboonEnum[LineageStatus] {
    case object Unknown extends LineageStatus
    case object Recorded extends LineageStatus
    
    def parse(s: String): Option[LineageStatus] = {
      s match {
        case "Unknown" => Some(Unknown)
        case "Recorded" => Some(Recorded)
        case _ => None
      }
    }
    
    def all: List[LineageStatus] = List(
      Unknown,
      Recorded
    ) 
  }
  
  object LineageStatus_JsonCodec extends BaboonJsonCodec.Base[LineageStatus, BaboonJsonCodec[LineageStatus]] {
    def encode(ctx: BaboonCodecContext, value: LineageStatus): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, LineageStatus] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          LineageStatus.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to LineageStatus: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to LineageStatus: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#LineageStatus"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[LineageStatus]] = Lazy(LineageStatus_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[LineageStatus]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[LineageStatus] = LazyInstance.value
  }
}