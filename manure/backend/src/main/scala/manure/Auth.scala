package manure

import java.nio.file.Path
import ponygirls.runtime.BoundedSecretFile
import java.security.{MessageDigest, SecureRandom}
import java.util.Base64
import java.sql.Connection
import cats.effect.IO
import ponygirls.auth.{AccountCredential,AccountIssued,AccountJson,AccountSession,AccountSql,AccountToken,AccountUser,Password}

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
final case class UserConfig(id: String, userType: String, tokens: Vector[TokenRef], displayName: String,
  enabled: Boolean = true, login: Option[String] = None, passwordHashFile: Option[Path] = None)
object UserConfig:
  def validate(users: Vector[UserConfig]): Unit =
    Require(users.nonEmpty && users.map(_.id).distinct.size == users.size, "bad-envelope")
    Require(users.flatMap(_.login).distinct.size == users.count(_.login.nonEmpty), "bad-envelope")
    users.foreach { user =>
      Require(user.id.nonEmpty && Set("human","agent")(user.userType) &&
        user.login.nonEmpty == user.passwordHashFile.nonEmpty &&
        (user.login.isEmpty || user.userType == "human" && user.login.exists(v => v.nonEmpty && v.length <= 128 && !v.exists(_.isControl))) &&
        (user.tokens.nonEmpty || user.login.nonEmpty) &&
        user.tokens.map(_.id).distinct.size == user.tokens.size && user.tokens.forall(t => t.id.nonEmpty && t.hashFile.toString.nonEmpty), "bad-envelope")
    }
final case class Credential(identity: Identity, hashFile: Path)

/** Reads provisioned hashes for each authentication and grant authorization.
  * Runtime file revocation/rotation therefore cannot leave cached grants live.
  * Plain tokens never enter object identity, logs, exception messages or storage.
  */
final class Auth(users: Vector[UserConfig]):
  UserConfig.validate(users)
  users.foreach(_.passwordHashFile.foreach(Password.readHash))
  // Startup validation includes duplicate digest ambiguity.
  private val initial = users.flatMap(u => u.tokens.map(t => SecretCodec.readHash(t.hashFile)))
  Require(initial.distinct.size == initial.size, "bad-envelope")
  private def provisioned: Vector[Credential] = users.filter(_.enabled).flatMap { user => user.tokens.flatMap { ref =>
    try Some(Credential(Identity(user.id, user.userType, ref.id, SecretCodec.readHash(ref.hashFile)), ref.hashFile))
    catch case _: Exception => None // Removed/malformed credentials fail closed.
  }}
  def authenticate(token: String): Option[Identity] =
    if !SecretCodec.canonical(token) then None
    else
      val digest = SecretCodec.sha256(token)
      val matches = provisioned.filter(c => SecretCodec.equal(c.identity.tokenDigest, digest))
      if matches.size == 1 then Some(matches.head.identity) else None
  private def configuredLive(user: String, token: String, digest: String): Boolean =
    val all = provisioned
    all.count(c => SecretCodec.equal(c.identity.tokenDigest, digest)) == 1 &&
      all.exists(c => c.identity.userId == user && c.identity.tokenId == token && SecretCodec.equal(c.identity.tokenDigest, digest))
  def accountUsers: Vector[AccountUser] = users.map { u =>
    val hash = u.passwordHashFile.map { path =>
      try Password.readHash(path)
      catch case _: Exception => throw DomainError("unavailable")
    }
    AccountUser(u.id,u.userType,u.displayName,u.login,hash,u.enabled)
  }
  def current(tx: AuthTxn): Vector[AccountUser] =
    val snapshot = accountUsers
    tx.reconcile(snapshot)
    snapshot
  def identity(credential: AccountCredential): Identity =
    Identity(credential.userId,credential.userType,credential.tokenId,credential.digest)
  def bearer(tx: AuthTxn,secret: String): Option[Identity] =
    val snapshot = current(tx)
    val configured = authenticate(secret)
    val issued = tx.bearer(snapshot,secret).map(identity)
    Require(!(configured.nonEmpty && issued.nonEmpty), "ambiguous-credentials")
    configured.orElse(issued)
  def browser(tx: AuthTxn,secret: String): Option[Identity] = tx.browser(current(tx),secret).map(identity)
  def credentialLive(tx: AuthTxn,user: String,token: String,digest: String): Boolean =
    val snapshot = current(tx)
    configuredLive(user,token,digest) || tx.live(snapshot,user,token,digest)
  def live(tx: MetadataTxn,identity: Identity): Boolean = live(tx.accounts,identity)
  def live(tx: AuthTxn,identity: Identity): Boolean = credentialLive(tx,identity.userId,identity.tokenId,identity.tokenDigest)
  def human(identity: Identity): Unit = Require(identity.userType == "human", "forbidden")
  def configuredTokens(owner: String): Vector[AccountToken] = users.find(_.id == owner).toVector.flatMap(_.tokens).map { token =>
    AccountToken(token.id,token.id,"configured",None,false,Vector("api"))
  }

trait AuthTxn:
  def initialize(): Unit
  def reconcile(users: Vector[AccountUser]): Unit
  def login(users: Vector[AccountUser],login: String,password: String): AccountSession
  def browser(users: Vector[AccountUser],secret: String): Option[AccountCredential]
  def bearer(users: Vector[AccountUser],secret: String): Option[AccountCredential]
  def live(users: Vector[AccountUser],user: String,token: String,digest: String): Boolean
  def logout(users: Vector[AccountUser],secret: String): Unit
  def tokens(owner: String): Vector[AccountToken]
  def issue(users: Vector[AccountUser],session: AccountCredential,name: String): AccountIssued
  def revoke(users: Vector[AccountUser],session: AccountCredential,id: String): Unit

private[manure] final class PostgresAuthTxn(c: Connection) extends AuthTxn:
  // Public Manure IDs are arbitrary byte-exact UTF-8 (including NUL/wide IDs).
  // The shared account store uses bounded text keys, never public/audit IDs.
  private def key(owner: String): String = SecretCodec.sha256("manure-account-owner-v1\u0000" + owner)
  private def directory(users: Vector[AccountUser]): Vector[AccountUser] =
    val mapped = users.map(u => u.copy(id=key(u.id)))
    Require(mapped.map(_.id).distinct.size == mapped.size, "unavailable")
    mapped
  private def stored(credential: AccountCredential): AccountCredential = credential.copy(userId=key(credential.userId))
  private def exposed(users: Vector[AccountUser],credential: AccountCredential): AccountCredential =
    credential.copy(userId=users.find(u => key(u.id) == credential.userId).getOrElse(throw DomainError("unavailable")).id)
  def initialize(): Unit = AccountSql.initialize(c)
  def reconcile(users: Vector[AccountUser]): Unit = AccountSql.reconcile(c,directory(users))
  def login(users: Vector[AccountUser],login: String,password: String): AccountSession =
    val session = AccountSql.login(c,directory(users),login,password)
    session.copy(credential=exposed(users,session.credential))
  def browser(users: Vector[AccountUser],secret: String): Option[AccountCredential] = AccountSql.browser(c,directory(users),secret).map(exposed(users,_))
  def bearer(users: Vector[AccountUser],secret: String): Option[AccountCredential] = AccountSql.bearer(c,directory(users),secret).map(exposed(users,_))
  def live(users: Vector[AccountUser],user: String,token: String,digest: String): Boolean = AccountSql.live(c,directory(users),key(user),token,digest)
  def logout(users: Vector[AccountUser],secret: String): Unit = AccountSql.logout(c,directory(users),secret)
  def tokens(owner: String): Vector[AccountToken] = AccountSql.tokens(c,key(owner))
  def issue(users: Vector[AccountUser],session: AccountCredential,name: String): AccountIssued = AccountSql.issue(c,directory(users),stored(session),name)
  def revoke(users: Vector[AccountUser],session: AccountCredential,id: String): Unit = AccountSql.revoke(c,directory(users),stored(session),id)

/** All browser/account mutations share the root-protected metadata transaction;
  * grant revocation and credential invalidation commit together.
  */
final class Accounts(metadata: Metadata,auth: Auth):
  def initialize(): IO[Unit] = metadata.transaction { tx => tx.accounts.initialize(); auth.current(tx.accounts); () }
  def bearer(secret: String): IO[Option[Identity]] = metadata.transaction(tx => auth.bearer(tx.accounts,secret))
  def browser(secret: String): IO[Option[Identity]] = metadata.transaction(tx => auth.browser(tx.accounts,secret))
  def login(login: String,password: String,previous: Option[String]): IO[(AccountUser,AccountSession)] = metadata.transaction { tx =>
    val users = auth.current(tx.accounts)
    val session = tx.accounts.login(users,login,password)
    previous.foreach { secret => tx.accounts.browser(users,secret).foreach { prior =>
      tx.accounts.logout(users,secret)
      tx.revokeCredential(prior.userId,prior.tokenId)
    }}
    (users.find(_.id == session.credential.userId).getOrElse(throw DomainError("unavailable")),session)
  }
  private def session(tx: MetadataTxn,secret: String): (Vector[AccountUser],AccountCredential,AccountUser) =
    val users = auth.current(tx.accounts)
    val principal = tx.accounts.browser(users,secret).getOrElse(throw DomainError("unauthorized"))
    val user = users.find(_.id == principal.userId).getOrElse(throw DomainError("unauthorized"))
    (users,principal,user)
  def read(secret: String): IO[(AccountUser,Vector[AccountToken])] = metadata.transaction { tx =>
    val (_,principal,user) = session(tx,secret)
    (user,auth.configuredTokens(principal.userId) ++ tx.accounts.tokens(principal.userId))
  }
  def issue(secret: String,name: String,actor: Vector[String]): IO[AccountIssued] = metadata.transaction { tx =>
    val (users,principal,_) = session(tx,secret)
    AccountJson.requireActor(actor,principal.userId)
    tx.accounts.issue(users,principal,name)
  }
  def revoke(secret: String,id: String,actor: Vector[String]): IO[Unit] = metadata.transaction { tx =>
    val (users,principal,_) = session(tx,secret)
    AccountJson.requireActor(actor,principal.userId)
    Require(!auth.configuredTokens(principal.userId).exists(_.id == id), "forbidden")
    tx.accounts.revoke(users,principal,id)
    tx.revokeCredential(principal.userId,id)
  }
  private def endSession(tx: MetadataTxn,users: Vector[AccountUser],principal: AccountCredential,secret: String): Unit =
    tx.accounts.logout(users,secret)
    tx.revokeCredential(principal.userId,principal.tokenId)
  def logout(secret: String): IO[Unit] = metadata.transaction { tx =>
    val (users,principal,_) = session(tx,secret)
    endSession(tx,users,principal,secret)
  }
  def logoutAccount(secret: String,actor: Vector[String]): IO[Unit] = metadata.transaction { tx =>
    val (users,principal,_) = session(tx,secret)
    AccountJson.requireActor(actor,principal.userId)
    endSession(tx,users,principal,secret)
  }

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
  def credential(header: Option[String],name: String): Option[String] =
    val values = header.toVector.flatMap(_.split(";").toVector).flatMap { part =>
      val split = part.indexOf('=')
      if split >= 0 && part.substring(0,split).trim == name then Some(part.substring(split+1)) else None
    }
    Require(values.size <= 1, "ambiguous-credentials")
    values.headOption
  def sessionName(loopbackDev: Boolean, insecure: Boolean): String =
    if loopbackDev then "manure-dev" else if insecure then "manure-http" else "__Host-manure"
  def grantName(loopbackDev: Boolean, insecure: Boolean, artifactId: String, pathMode: Boolean): String =
    if pathMode then
      (if loopbackDev then "mgrant-dev-" else if insecure then "mgrant-http-" else "__Secure-mgrant-") + artifactId
    else if loopbackDev then "mgrant-dev" else if insecure then "mgrant-http" else "__Host-mgrant"
