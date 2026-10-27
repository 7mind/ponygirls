import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api.v1_3_0 {
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.5.0")
  sealed trait TokenSource
  
  object TokenSource extends BaboonEnum[TokenSource] {
    case object Issued extends TokenSource
    case object StaticConfig extends TokenSource
    
    def parse(s: String): Option[TokenSource] = {
      s match {
        case "Issued" => Some(Issued)
        case "StaticConfig" => Some(StaticConfig)
        case _ => None
      }
    }
    
    def all: List[TokenSource] = List(
      Issued,
      StaticConfig
    ) 
  }
  
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.5.0")
  object TokenSource_JsonCodec extends BaboonJsonCodec.Base[TokenSource, BaboonJsonCodec[TokenSource]] {
    def encode(ctx: BaboonCodecContext, value: TokenSource): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, TokenSource] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          TokenSource.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to TokenSource: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to TokenSource: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.3.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#TokenSource"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[TokenSource]] = Lazy(TokenSource_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[TokenSource]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[TokenSource] = LazyInstance.value
  }
}