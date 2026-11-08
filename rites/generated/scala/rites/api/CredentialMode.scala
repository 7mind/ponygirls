import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package rites.api {
  sealed trait CredentialMode
  
  object CredentialMode extends BaboonEnum[CredentialMode] {
    case object Token extends CredentialMode
    case object Oauth extends CredentialMode
    
    def parse(s: String): Option[CredentialMode] = {
      s match {
        case "Token" => Some(Token)
        case "Oauth" => Some(Oauth)
        case _ => None
      }
    }
    
    def all: List[CredentialMode] = List(
      Token,
      Oauth
    ) 
  }
  
  object CredentialMode_JsonCodec extends BaboonJsonCodec.Base[CredentialMode, BaboonJsonCodec[CredentialMode]] {
    def encode(ctx: BaboonCodecContext, value: CredentialMode): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CredentialMode] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          CredentialMode.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CredentialMode: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CredentialMode: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "0.2.0"
    
    def baboonDomainIdentifier: String = "rites.api"
    
    def baboonTypeIdentifier: String = "rites.api/:#CredentialMode"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CredentialMode]] = Lazy(CredentialMode_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CredentialMode]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CredentialMode] = LazyInstance.value
  }
}