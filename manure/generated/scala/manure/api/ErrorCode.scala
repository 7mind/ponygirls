import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package manure.api {
  sealed trait ErrorCode
  
  object ErrorCode extends BaboonEnum[ErrorCode] {
    case object BadEnvelope extends ErrorCode
    case object InvalidPath extends ErrorCode
    case object InvalidManifest extends ErrorCode
    case object InvalidRange extends ErrorCode
    case object InvalidTtl extends ErrorCode
    case object InvalidVisibility extends ErrorCode
    case object BadHost extends ErrorCode
    case object AmbiguousCredentials extends ErrorCode
    case object Unauthorized extends ErrorCode
    case object PasswordRequired extends ErrorCode
    case object PasswordInvalid extends ErrorCode
    case object GrantRequired extends ErrorCode
    case object GrantInvalid extends ErrorCode
    case object GrantExpired extends ErrorCode
    case object SessionNotOwned extends ErrorCode
    case object Forbidden extends ErrorCode
    case object TlsRequired extends ErrorCode
    case object NotFound extends ErrorCode
    case object DashboardDisabled extends ErrorCode
    case object ChunkConflict extends ErrorCode
    case object StateConflict extends ErrorCode
    case object HashMismatch extends ErrorCode
    case object IncompleteUpload extends ErrorCode
    case object Expired extends ErrorCode
    case object TooLarge extends ErrorCode
    case object QuotaExceeded extends ErrorCode
    case object SessionLimit extends ErrorCode
    case object RateLimited extends ErrorCode
    case object Unavailable extends ErrorCode
    case object UnsupportedVersion extends ErrorCode
    case object SearchUnavailable extends ErrorCode
    case object SearchNotReady extends ErrorCode
    
    def parse(s: String): Option[ErrorCode] = {
      s match {
        case "BadEnvelope" => Some(BadEnvelope)
        case "InvalidPath" => Some(InvalidPath)
        case "InvalidManifest" => Some(InvalidManifest)
        case "InvalidRange" => Some(InvalidRange)
        case "InvalidTtl" => Some(InvalidTtl)
        case "InvalidVisibility" => Some(InvalidVisibility)
        case "BadHost" => Some(BadHost)
        case "AmbiguousCredentials" => Some(AmbiguousCredentials)
        case "Unauthorized" => Some(Unauthorized)
        case "PasswordRequired" => Some(PasswordRequired)
        case "PasswordInvalid" => Some(PasswordInvalid)
        case "GrantRequired" => Some(GrantRequired)
        case "GrantInvalid" => Some(GrantInvalid)
        case "GrantExpired" => Some(GrantExpired)
        case "SessionNotOwned" => Some(SessionNotOwned)
        case "Forbidden" => Some(Forbidden)
        case "TlsRequired" => Some(TlsRequired)
        case "NotFound" => Some(NotFound)
        case "DashboardDisabled" => Some(DashboardDisabled)
        case "ChunkConflict" => Some(ChunkConflict)
        case "StateConflict" => Some(StateConflict)
        case "HashMismatch" => Some(HashMismatch)
        case "IncompleteUpload" => Some(IncompleteUpload)
        case "Expired" => Some(Expired)
        case "TooLarge" => Some(TooLarge)
        case "QuotaExceeded" => Some(QuotaExceeded)
        case "SessionLimit" => Some(SessionLimit)
        case "RateLimited" => Some(RateLimited)
        case "Unavailable" => Some(Unavailable)
        case "UnsupportedVersion" => Some(UnsupportedVersion)
        case "SearchUnavailable" => Some(SearchUnavailable)
        case "SearchNotReady" => Some(SearchNotReady)
        case _ => None
      }
    }
    
    def all: List[ErrorCode] = List(
      BadEnvelope,
      InvalidPath,
      InvalidManifest,
      InvalidRange,
      InvalidTtl,
      InvalidVisibility,
      BadHost,
      AmbiguousCredentials,
      Unauthorized,
      PasswordRequired,
      PasswordInvalid,
      GrantRequired,
      GrantInvalid,
      GrantExpired,
      SessionNotOwned,
      Forbidden,
      TlsRequired,
      NotFound,
      DashboardDisabled,
      ChunkConflict,
      StateConflict,
      HashMismatch,
      IncompleteUpload,
      Expired,
      TooLarge,
      QuotaExceeded,
      SessionLimit,
      RateLimited,
      Unavailable,
      UnsupportedVersion,
      SearchUnavailable,
      SearchNotReady
    ) 
  }
  
  object ErrorCode_JsonCodec extends BaboonJsonCodec.Base[ErrorCode, BaboonJsonCodec[ErrorCode]] {
    def encode(ctx: BaboonCodecContext, value: ErrorCode): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ErrorCode] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ErrorCode.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ErrorCode: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ErrorCode: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.0.0"
    
    def baboonDomainIdentifier: String = "manure.api"
    
    def baboonTypeIdentifier: String = "manure.api/:#ErrorCode"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ErrorCode]] = Lazy(ErrorCode_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ErrorCode]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ErrorCode] = LazyInstance.value
  }
}