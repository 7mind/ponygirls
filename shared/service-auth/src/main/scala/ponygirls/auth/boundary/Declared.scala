package ponygirls.auth.boundary

import cats.syntax.all.*
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.security.MessageDigest
import ponygirls.auth.{AccountOrigin, AccountToken, AccountUser, DeclaredDirectory, ImperativeSettings, Password, Secrets, TotpVault}
import ponygirls.runtime.BoundedSecretFile
import scala.util.control.NonFatal

/** A runtime credential file of exactly `length` ASCII bytes matching `pattern`, with at most one terminal LF. */
object ExactCredentialFile {
  def read(path: String, length: Int, pattern: String): Either[ConfigRefusal, String] = {
    // At most exact bytes + optional LF + one overflow byte. A malformed
    // runtime file cannot force allocation proportional to its source size.
    val read = try {
      val input = Files.newInputStream(Path.of(path))
      try Right(input.readNBytes(length + 2)) finally input.close()
    } catch { case _: Exception => Left(ConfigRefusal.UnreadableCredentialFile) }
    read.flatMap { raw =>
      val body = if (raw.lastOption.contains(10.toByte)) raw.dropRight(1) else raw
      val text = new String(body, StandardCharsets.US_ASCII)
      if (body.length != length || body.exists(b => b < 0 || b == 0 || b == 10 || b == 13) || !text.matches(pattern)) Left(ConfigRefusal.MalformedCredentialFile)
      else Right(text)
    }
  }
}

/** Reads the SHA-256 digest (64 lower-case hex ASCII, at most one terminal LF) of a configured API token from its
  * runtime file. The readers differ in which files they open and how they bound the read. */
sealed trait DigestReader {
  def read(path: String): Either[ConfigRefusal, String]
}
object DigestReader {
  private val Length = 64
  private val Pattern = "[0-9a-f]{64}"
  /** `ExactCredentialFile`: any path the process can open, read to the exact length plus two bytes. */
  object Stream extends DigestReader {
    def read(path: String): Either[ConfigRefusal, String] = ExactCredentialFile.read(path, Length, Pattern)
  }
  /** `BoundedSecretFile`: a regular file after resolving symbolic links (a relative path against the working
    * directory), valid UTF-8, read to the exact length plus one LF; anything else is unreadable. */
  object Bounded extends DigestReader {
    def read(path: String): Either[ConfigRefusal, String] = {
      val text = try Right(BoundedSecretFile.read(Path.of(path).toAbsolutePath, Length + 1).stripSuffix("\n"))
        catch { case NonFatal(_) => Left(ConfigRefusal.UnreadableCredentialFile) }
      text.filterOrElse(_.matches(Pattern), ConfigRefusal.MalformedCredentialFile)
    }
  }
}

/** When configured digests are read: once per configuration load, or again on every check (a removed or rewritten
  * file then takes effect without a reload). */
enum DigestRead { case Snapshot, PerCheck }

/** Who a configured token authenticates. */
final case class ConfiguredToken(userId: String, userType: String, tokenId: String)

/** The configured API tokens of the declared users. Only canonical secrets are looked up; lookup compares every
  * digest in constant time per digest. */
trait ConfiguredTokens {
  def authenticate(secret: String): Option[ConfiguredToken]
  /** Whether a grant persisted for user `userId`, token `tokenId` and token digest `digest` is still live: exactly one
    * configured token of an enabled user has that digest, and it is that user's token of that id. The user type is
    * not compared (a persisted grant does not record it); `authenticate` compares it. */
  def live(userId: String, tokenId: String, digest: String): Boolean
  /** The configured tokens of `owner` as account-protocol metadata (`source: "configured"`, scope `api`). */
  def listed(owner: String): Vector[AccountToken]
}
object ConfiguredTokens {
  val Source = "configured"
  val Scopes: Vector[String] = ponygirls.auth.AccountScopes.Api
}

/** Lookup by digest over the enabled users' configured tokens; listing over every declared user. */
private abstract class DigestTokens(users: Vector[DeclaredUserConfig]) extends ConfiguredTokens {
  protected def byDigest(digest: String): Option[ConfiguredToken]
  def authenticate(secret: String): Option[ConfiguredToken] = if (Secrets.canonical(secret)) byDigest(Secrets.digest(secret)) else None
  def live(userId: String, tokenId: String, digest: String): Boolean = byDigest(digest).exists(token => token.userId == userId && token.tokenId == tokenId)
  def listed(owner: String): Vector[AccountToken] =
    users.find(_.id == owner).toVector.flatMap(_.tokens).map(t => AccountToken(t.id, t.id, ConfiguredTokens.Source, None, false, ConfiguredTokens.Scopes))
  protected def matching(digest: String, stored: Vector[(Array[Byte], ConfiguredToken)]): Vector[ConfiguredToken] = {
    val presented = digest.getBytes(StandardCharsets.US_ASCII)
    stored.filter((bytes, _) => MessageDigest.isEqual(presented, bytes)).map(_._2)
  }
}

/** Digests read once per configuration load; the load refused a digest that two tokens share. */
private final class SnapshotTokens(users: Vector[DeclaredUserConfig], digests: Vector[(Array[Byte], ConfiguredToken)]) extends DigestTokens(users) {
  protected def byDigest(digest: String): Option[ConfiguredToken] = matching(digest, digests).lastOption
}

/** Digests read again on every check: a removed, unreadable or malformed file fails closed for its token alone, and
  * a digest that several tokens share after the load matches none of them. */
private final class PerCheckTokens(users: Vector[DeclaredUserConfig], enabled: Vector[(DeclaredTokenConfig, ConfiguredToken)], reader: DigestReader)
    extends DigestTokens(users) {
  protected def byDigest(digest: String): Option[ConfiguredToken] = {
    val current = enabled.flatMap((config, token) => reader.read(config.hashFile).toOption.map(_.getBytes(StandardCharsets.US_ASCII) -> token))
    matching(digest, current) match {
      case Vector(token) => Some(token)
      case _ => None
    }
  }
}

final case class DeclaredTokenConfig(id: String, hashFile: String)
/** A user of the service configuration: `login` and `passwordHashFile` together or neither; `admin` makes the user a
  * declarative account administrator. */
final case class DeclaredUserConfig(id: String, userType: String, displayName: String, tokens: Vector[DeclaredTokenConfig],
  login: Option[String], passwordHashFile: Option[String], enabled: Boolean, admin: Boolean)

/** The loaded declared users: account users for reconciliation, the declared directory and the configured tokens. */
final case class Declared(users: Vector[AccountUser], directory: DeclaredDirectory, tokens: ConfiguredTokens)

/** Which user ids, token ids and logins a service admits. */
trait DeclaredIdRules {
  def userId(id: String, admin: Boolean): Boolean
  def tokenId(id: String): Boolean
  def login(login: String): Boolean
}
object DeclaredIdRules {
  private val MaximumLogin = 128
  private val MaximumUserId = 128
  private val MaximumTokenId = 64
  // Baseline ECMAScript /[^\\s:]{1,n}/ counts UTF16 units. Java's
  // isWhitespace additionally classifies U+001C..001F as separators and Java
  // regex quantifiers count supplementary code points; neither may alter
  // an acknowledged author/token identity or credential mapping.
  private def idWhitespace(c: Char): Boolean =
    c >= '\u0009' && c <= '\u000d' || c == ' ' || c == '\u00a0' || c == '\u1680' ||
    c >= '\u2000' && c <= '\u200a' || c == '\u2028' || c == '\u2029' ||
    c == '\u202f' || c == '\u205f' || c == '\u3000' || c == '\ufeff'
  private def attributionId(value: String, max: Int): Boolean = value.nonEmpty && value.length <= max && !value.exists(c => c == ':' || idWhitespace(c))

  /** Haystack: ids are author and token attributions (at most 128 and 64 UTF-16 units, no whitespace, no `:`);
    * logins have no surrounding whitespace. */
  val Haystack: DeclaredIdRules = new DeclaredIdRules {
    def userId(id: String, admin: Boolean): Boolean = attributionId(id, MaximumUserId)
    def tokenId(id: String): Boolean = attributionId(id, MaximumTokenId)
    def login(login: String): Boolean = login.nonEmpty && login.length <= MaximumLogin && login == login.trim && !login.exists(_.isControl)
  }
  /** Manure: ids are arbitrary UTF-8 (`manure/docs/account-auth.md`), except that an administrator's id is
    * recorded in the text provenance columns of imperative accounts, which cannot hold NUL. */
  val Manure: DeclaredIdRules = new DeclaredIdRules {
    def userId(id: String, admin: Boolean): Boolean = id.nonEmpty && !(admin && id.contains('\u0000'))
    def tokenId(id: String): Boolean = id.nonEmpty
    def login(login: String): Boolean = login.nonEmpty && login.length <= MaximumLogin && !login.exists(_.isControl)
  }
}

object DeclaredUsers {
  private val UserTypes = Set("human", "agent")
  private val PasswordUserType = "human"

  private def unique(values: Vector[String], refusal: ConfigRefusal): Either[ConfigRefusal, Unit] =
    Either.cond(values.distinct.size == values.size, (), refusal)
  private def check(valid: Boolean, refusal: ConfigRefusal): Either[ConfigRefusal, Unit] = Either.cond(valid, (), refusal)

  /** At least one user, and unique user ids. `load` checks this first, too. */
  def identities(users: Vector[DeclaredUserConfig]): Either[ConfigRefusal, Unit] =
    check(users.nonEmpty, ConfigRefusal.NoUsers) *> unique(users.map(_.id), ConfigRefusal.DuplicateUserId)

  /** Validates the users, reads their password-hash and digest files and refuses a digest that two tokens share. */
  def load(users: Vector[DeclaredUserConfig], rules: DeclaredIdRules, read: DigestRead, reader: DigestReader): Either[ConfigRefusal, Declared] = for {
    _ <- identities(users)
    _ <- unique(users.flatMap(_.login), ConfigRefusal.DuplicateLogin)
    accountUsers <- users.traverse { user =>
      for {
        _ <- check(user.login.isDefined == user.passwordHashFile.isDefined && !(user.login.isDefined && user.userType != PasswordUserType), ConfigRefusal.InvalidPasswordCredentials)
        _ <- user.login.traverse_(login => check(rules.login(login), ConfigRefusal.InvalidLogin))
        passwordHash <- user.passwordHashFile.traverse { path =>
          try Right(Password.readHash(Path.of(path))) catch { case _: Exception => Left(ConfigRefusal.InvalidPasswordFile) }
        }
      } yield AccountUser(user.id, user.userType, user.displayName, user.login, passwordHash, user.enabled, AccountOrigin.Declarative)
    }
    entries <- users.flatTraverse { user =>
      for {
        _ <- check(rules.userId(user.id, user.admin) && UserTypes.contains(user.userType), ConfigRefusal.InvalidUser)
        _ <- check(user.tokens.nonEmpty || user.login.nonEmpty, ConfigRefusal.NoCredentials)
        _ <- unique(user.tokens.map(_.id), ConfigRefusal.DuplicateTokenId)
        digests <- user.tokens.traverse { token =>
          check(rules.tokenId(token.id), ConfigRefusal.InvalidTokenId).flatMap { _ =>
            reader.read(token.hashFile).map(digest => (digest, token, ConfiguredToken(user.id, user.userType, token.id)))
          }
        }
      } yield digests
    }
    _ <- unique(entries.map(_._1), ConfigRefusal.DigestAssignedTwice)
  } yield {
    val directory = DeclaredDirectory(accountUsers, users.filter(_.admin).map(_.id).toSet)
    val enabled = entries.filter { (_, _, token) => accountUsers.exists(u => u.id == token.userId && u.enabled) }
    val tokens = read match {
      case DigestRead.Snapshot => new SnapshotTokens(users, enabled.map((digest, _, token) => digest.getBytes(StandardCharsets.US_ASCII) -> token))
      case DigestRead.PerCheck => new PerCheckTokens(users, enabled.map((_, config, token) => config -> token), reader)
    }
    Declared(accountUsers, directory, tokens)
  }
}

/** The service's `accounts` settings (design §6.1): imperative accounts. */
final case class ImperativeAccountsConfig(enabled: Boolean, keyFile: Option[String], signupEnabled: Boolean, requireApproval: Boolean,
  maxUsers: Int, enrollmentEnabled: Boolean, enrollmentTtlSeconds: Long, issuer: Option[String], reservedUsernames: Vector[String])

/** Which key-file paths are runtime paths outside the Nix store. */
sealed trait KeyFilePolicy {
  def admits(path: String): Boolean
}
object KeyFilePolicy {
  private val NixStore = "/nix/store"
  /** Haystack: the text starts with `/` and not with `/nix/store/`; `..` segments are not resolved. */
  object LiteralStorePrefix extends KeyFilePolicy {
    def admits(path: String): Boolean = path.startsWith("/") && !path.startsWith(NixStore + "/")
  }
  /** Manure: an absolute path whose normalised form is neither the store directory nor below it. */
  object NormalizedPath extends KeyFilePolicy {
    def admits(path: String): Boolean = scala.util.Try(Path.of(path)).toOption.exists(p => p.isAbsolute && !p.normalize().startsWith(Path.of(NixStore)))
  }
}

object ImperativeConfig {
  /** Design §6.2–§6.3: the creation flags never imply the master switch; the master switch requires the key
    * file, an issuer and an enabled declarative admin; the remaining bounds are checked by `ImperativeSettings`.
    * `None` while the master switch is off. `service` is bound into the associated data of every encrypted TOTP secret.
    */
  def settings(service: String, accounts: Option[ImperativeAccountsConfig], declared: DeclaredDirectory,
      keyFiles: KeyFilePolicy): Either[ConfigRefusal, Option[ImperativeSettings]] =
    accounts match {
      case None => Right(None)
      case Some(a) if !a.enabled => Either.cond(!a.signupEnabled && !a.enrollmentEnabled, None, ConfigRefusal.AccountsFlagsWithoutSwitch)
      case Some(a) => for {
        keyFile <- a.keyFile.filter(keyFiles.admits).toRight(ConfigRefusal.AccountsKeyFile)
        issuer <- a.issuer.toRight(ConfigRefusal.AccountsIssuer)
        _ <- Either.cond(declared.users.exists(user => user.enabled && declared.admins(user.id)), (), ConfigRefusal.AccountsAdmin)
      } yield Some(ImperativeSettings(service, a.signupEnabled, a.requireApproval, a.enrollmentEnabled, a.maxUsers,
        java.time.Duration.ofSeconds(a.enrollmentTtlSeconds), issuer, a.reservedUsernames.toSet, TotpVault.load(Path.of(keyFile), service)))
    }
}
