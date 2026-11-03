package manure

import java.nio.file.Path
import ponygirls.runtime.BoundedSecretFile
import java.security.{MessageDigest, SecureRandom}
import java.util.Base64

object SecretCodec:
  private val random = new SecureRandom()
  private val encoder = Base64.getUrlEncoder.withoutPadding()
  def token(): String =
    val bytes = new Array[Byte](32); random.nextBytes(bytes); encoder.encodeToString(bytes)
  def artifactId(): String =
    val bytes = new Array[Byte](16); random.nextBytes(bytes); hex(bytes)
  def hex(bytes: Array[Byte]): String = bytes.map(b => f"${b & 0xff}%02x").mkString
  def sha256(bytes: Array[Byte]): String = hex(MessageDigest.getInstance("SHA-256").digest(bytes))
  def sha256(value: String): String = sha256(Exact.utf8(value))
  def canonical(value: String): Boolean =
    if !value.matches("[A-Za-z0-9_-]{43}") then false
    else try
      val bytes = Base64.getUrlDecoder.decode(value)
      bytes.length == 32 && encoder.encodeToString(bytes) == value
    catch case _: IllegalArgumentException => false
  def equal(a: String, b: String): Boolean = MessageDigest.isEqual(Exact.utf8(a), Exact.utf8(b))
  def verify(candidate: String, digest: String): Boolean = equal(sha256(candidate), digest)
  def readHash(path: Path): String =
    // Trusted operator credential references may be managed symlinks, never
    // payload paths. Reject special leaves before opening and bound the actual
    // read. Keep the old codec EXACT: one optional LF, never trim/CRLF/casefold.
    val text = BoundedSecretFile.read(path.toAbsolutePath,65).stripSuffix("\n")
    Require(text.matches("[0-9a-f]{64}"), "bad-envelope"); text
  def readToken(path: Path): String =
    val text = BoundedSecretFile.read(path.toAbsolutePath,44).stripSuffix("\n")
    Require(canonical(text), "bad-envelope"); text

final case class TokenRef(id: String, hashFile: Path)
final case class UserConfig(id: String, userType: String, tokens: Vector[TokenRef], displayName: String)
final case class Credential(identity: Identity, hashFile: Path)

/** Reads provisioned hashes for each authentication and grant authorization.
  * Runtime file revocation/rotation therefore cannot leave cached grants live.
  * Plain tokens never enter object identity, logs, exception messages or storage.
  */
final class Auth(users: Vector[UserConfig]):
  Require(users.nonEmpty && users.map(_.id).distinct.size == users.size, "bad-envelope")
  users.foreach { user =>
    Require(user.id.nonEmpty && Set("human", "agent")(user.userType) && user.tokens.nonEmpty &&
      user.tokens.map(_.id).distinct.size == user.tokens.size && user.tokens.forall(_.id.nonEmpty), "bad-envelope")
  }
  // Startup validation includes duplicate digest ambiguity.
  private val initial = users.flatMap(u => u.tokens.map(t => SecretCodec.readHash(t.hashFile)))
  Require(initial.distinct.size == initial.size, "bad-envelope")
  private def provisioned: Vector[Credential] = users.flatMap { user => user.tokens.flatMap { ref =>
    try Some(Credential(Identity(user.id, user.userType, ref.id, SecretCodec.readHash(ref.hashFile)), ref.hashFile))
    catch case _: Exception => None // Removed/malformed credentials fail closed.
  }}
  def authenticate(token: String): Option[Identity] =
    if !SecretCodec.canonical(token) then None
    else
      val digest = SecretCodec.sha256(token)
      val matches = provisioned.filter(c => SecretCodec.equal(c.identity.tokenDigest, digest))
      if matches.size == 1 then Some(matches.head.identity) else None
  def credentialLive(user: String, token: String, digest: String): Boolean =
    val all = provisioned
    all.count(c => SecretCodec.equal(c.identity.tokenDigest, digest)) == 1 &&
      all.exists(c => c.identity.userId == user && c.identity.tokenId == token && SecretCodec.equal(c.identity.tokenDigest, digest))
  def live(identity: Identity): Boolean = credentialLive(identity.userId, identity.tokenId, identity.tokenDigest)
  def human(identity: Identity): Unit = Require(identity.userType == "human", "forbidden")

object Cookies:
  /** First name wins; credential values are deliberately not trimmed/unquoted. */
  def parse(header: Option[String]): Map[String, String] = header.toVector.flatMap(_.split(";").toVector)
    .foldLeft(Map.empty[String, String]) { (out, part) =>
      val split = part.indexOf('=')
      if split < 0 then out
      else
        val key = part.substring(0, split).trim
        if key.isEmpty || out.contains(key) then out else out.updated(key, part.substring(split + 1))
    }
  def sessionName(loopbackDev: Boolean, insecure: Boolean): String =
    if loopbackDev then "manure-dev" else if insecure then "manure-http" else "__Host-manure"
  def grantName(loopbackDev: Boolean, insecure: Boolean, artifactId: String, pathMode: Boolean): String =
    if pathMode then
      (if loopbackDev then "mgrant-dev-" else if insecure then "mgrant-http-" else "__Secure-mgrant-") + artifactId
    else if loopbackDev then "mgrant-dev" else if insecure then "mgrant-http" else "__Host-mgrant"
