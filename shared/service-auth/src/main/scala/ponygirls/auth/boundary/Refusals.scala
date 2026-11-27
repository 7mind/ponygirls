package ponygirls.auth.boundary

/** Why the request boundary refused. Each service maps a refusal to its own failure code, message and status. */
enum Refusal {
  case DisallowedHost, AmbiguousOrigin, DisallowedOrigin, OriginHostMismatch, SameOriginProofMissing,
    BrowserSessionRequired, CookieNotAccepted, DuplicateSessionCookie, AmbiguousCredentials, InvalidCredentials,
    // The account plane's envelope: one Host and at most one Sec-Fetch-Site, no query, JSON bodies within the limit.
    AmbiguousHost, QueryParameters, JsonRequired, BodyTooLarge, BodyOnGet, EmptyObjectRequired, OriginRequired, OneContentTypeRequired
}
final case class BoundaryRefused(refusal: Refusal) extends RuntimeException(refusal.toString)

/** Why a configuration was refused. Each service maps a refusal to its own failure code and message. */
enum ConfigRefusal {
  case MalformedOrigin, NonCanonicalOrigin, InsecureOriginNotDedicated,
    NoUsers, DuplicateUserId, DuplicateLogin, InvalidPasswordCredentials, InvalidLogin, InvalidPasswordFile, InvalidUser,
    NoCredentials, DuplicateTokenId, InvalidTokenId, UnreadableCredentialFile, MalformedCredentialFile, DigestAssignedTwice,
    AccountsFlagsWithoutSwitch, AccountsKeyFile, AccountsIssuer, AccountsAdmin
}
/** A configured value a request check needed turned out invalid (only from a policy that was not checked at load). */
final case class ConfigRefused(refusal: ConfigRefusal) extends RuntimeException(refusal.toString)
