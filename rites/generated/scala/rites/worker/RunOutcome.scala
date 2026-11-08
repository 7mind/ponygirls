import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package rites.worker {
  sealed trait RunOutcome
  
  object RunOutcome extends BaboonEnum[RunOutcome] {
    case object Completed extends RunOutcome
    case object Failed extends RunOutcome
    case object Cancelled extends RunOutcome
    
    def parse(s: String): Option[RunOutcome] = {
      s match {
        case "Completed" => Some(Completed)
        case "Failed" => Some(Failed)
        case "Cancelled" => Some(Cancelled)
        case _ => None
      }
    }
    
    def all: List[RunOutcome] = List(
      Completed,
      Failed,
      Cancelled
    ) 
  }
  
  object RunOutcome_JsonCodec extends BaboonJsonCodec.Base[RunOutcome, BaboonJsonCodec[RunOutcome]] {
    def encode(ctx: BaboonCodecContext, value: RunOutcome): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RunOutcome] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          RunOutcome.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to RunOutcome: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to RunOutcome: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "rites.worker"
    
    def baboonTypeIdentifier: String = "rites.worker/:#RunOutcome"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RunOutcome]] = Lazy(RunOutcome_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RunOutcome]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RunOutcome] = LazyInstance.value
  }
}