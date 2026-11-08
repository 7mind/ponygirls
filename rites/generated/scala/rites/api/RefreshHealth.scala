import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package rites.api {
  sealed trait RefreshHealth
  
  object RefreshHealth extends BaboonEnum[RefreshHealth] {
    case object Healthy extends RefreshHealth
    case object Due extends RefreshHealth
    case object Uncertain extends RefreshHealth
    case object Failed extends RefreshHealth
    
    def parse(s: String): Option[RefreshHealth] = {
      s match {
        case "Healthy" => Some(Healthy)
        case "Due" => Some(Due)
        case "Uncertain" => Some(Uncertain)
        case "Failed" => Some(Failed)
        case _ => None
      }
    }
    
    def all: List[RefreshHealth] = List(
      Healthy,
      Due,
      Uncertain,
      Failed
    ) 
  }
  
  object RefreshHealth_JsonCodec extends BaboonJsonCodec.Base[RefreshHealth, BaboonJsonCodec[RefreshHealth]] {
    def encode(ctx: BaboonCodecContext, value: RefreshHealth): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RefreshHealth] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          RefreshHealth.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to RefreshHealth: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to RefreshHealth: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.2.0"
    
    def baboonDomainIdentifier: String = "rites.api"
    
    def baboonTypeIdentifier: String = "rites.api/:#RefreshHealth"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RefreshHealth]] = Lazy(RefreshHealth_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RefreshHealth]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RefreshHealth] = LazyInstance.value
  }
}