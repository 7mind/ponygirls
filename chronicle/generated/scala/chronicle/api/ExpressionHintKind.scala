import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api {
  sealed trait ExpressionHintKind
  
  object ExpressionHintKind extends BaboonEnum[ExpressionHintKind] {
    case object Field extends ExpressionHintKind
    case object Value extends ExpressionHintKind
    case object Operator extends ExpressionHintKind
    
    def parse(s: String): Option[ExpressionHintKind] = {
      s match {
        case "Field" => Some(Field)
        case "Value" => Some(Value)
        case "Operator" => Some(Operator)
        case _ => None
      }
    }
    
    def all: List[ExpressionHintKind] = List(
      Field,
      Value,
      Operator
    ) 
  }
  
  object ExpressionHintKind_JsonCodec extends BaboonJsonCodec.Base[ExpressionHintKind, BaboonJsonCodec[ExpressionHintKind]] {
    def encode(ctx: BaboonCodecContext, value: ExpressionHintKind): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ExpressionHintKind] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ExpressionHintKind.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ExpressionHintKind: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ExpressionHintKind: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.8.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#ExpressionHintKind"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ExpressionHintKind]] = Lazy(ExpressionHintKind_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ExpressionHintKind]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ExpressionHintKind] = LazyInstance.value
  }
}