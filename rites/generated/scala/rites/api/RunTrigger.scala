import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package rites.api {
  sealed trait RunTrigger
  
  object RunTrigger extends BaboonEnum[RunTrigger] {
    case object Schedule extends RunTrigger
    case object Manual extends RunTrigger
    
    def parse(s: String): Option[RunTrigger] = {
      s match {
        case "Schedule" => Some(Schedule)
        case "Manual" => Some(Manual)
        case _ => None
      }
    }
    
    def all: List[RunTrigger] = List(
      Schedule,
      Manual
    ) 
  }
  
  object RunTrigger_JsonCodec extends BaboonJsonCodec.Base[RunTrigger, BaboonJsonCodec[RunTrigger]] {
    def encode(ctx: BaboonCodecContext, value: RunTrigger): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RunTrigger] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          RunTrigger.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to RunTrigger: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to RunTrigger: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "rites.api"
    
    def baboonTypeIdentifier: String = "rites.api/:#RunTrigger"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RunTrigger]] = Lazy(RunTrigger_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RunTrigger]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RunTrigger] = LazyInstance.value
  }
}