import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package ontology.api {
  sealed trait ReadView
  
  object ReadView extends BaboonEnum[ReadView] {
    case object Current extends ReadView
    case object History extends ReadView
    case object BindingContext extends ReadView
    
    def parse(s: String): Option[ReadView] = {
      s match {
        case "Current" => Some(Current)
        case "History" => Some(History)
        case "BindingContext" => Some(BindingContext)
        case _ => None
      }
    }
    
    def all: List[ReadView] = List(
      Current,
      History,
      BindingContext
    ) 
  }
  
  object ReadView_JsonCodec extends BaboonJsonCodec.Base[ReadView, BaboonJsonCodec[ReadView]] {
    def encode(ctx: BaboonCodecContext, value: ReadView): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ReadView] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ReadView.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ReadView: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ReadView: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.1.0"
    
    def baboonDomainIdentifier: String = "ontology.api"
    
    def baboonTypeIdentifier: String = "ontology.api/:#ReadView"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ReadView]] = Lazy(ReadView_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ReadView]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ReadView] = LazyInstance.value
  }
}