package ponygirls.auth.boundary

import cats.syntax.all.*
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.security.MessageDigest
import ponygirls.auth.{AccountOrigin, AccountToken, AccountUser, DeclaredDirectory, ImperativeSettings, Password, Secrets, TotpVault}

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

/** The SHA-256 digest (64 lower-case hex) of a configured API token, read from its runtime file. */
object DigestFile {
  def read(path: String): Either[ConfigRefusal, String] = ExactCredentialFile.read(path, 64, "[0-9a-f]{64}")
}

/** Who a configured token authenticates. */
final case class ConfiguredToken(userId: String, userType: String, tokenId: String)

/** The configured API tokens of the declared users. Only canonical secrets are looked up; lookup compares every
  * digest in constant time per digest. */
trait ConfiguredTokens {
  def authenticate(secret: String): Option[ConfiguredToken]
  /** The configured tokens of `owner` as account-protocol metadata (`source: "configured"`, scope `api`). */
  def listed(owner: String): Vector[AccountToken]
}
object ConfiguredTokens {
  val Source = "configured"
  val Scopes: Vector[String] = Vector("api")
}

/** Digests read once per configuration load; the tokens of disabled users are left out. */
private final class SnapshotTokens(users: Vector[DeclaredUserConfig], digests: Vector[(Array[Byte], ConfiguredToken)]) extends ConfiguredTokens {
  def authenticate(secret: String): Option[ConfiguredToken] = {
    if (!Secrets.canonical(secret)) return None
    val presented = Secrets.digest(secret).getBytes(StandardCharsets.US_ASCII)
    var result: Option[ConfiguredToken] = None
    digests.foreach { case (digest, token) => if (MessageDigest.isEqual(presented, digest)) result = Some(token) }
    result
  }
  def listed(owner: String): Vector[AccountToken] =
    users.find(_.id == owner).toVector.flatMap(_.tokens).map(t => AccountToken(t.id, t.id, ConfiguredTokens.Source, None, false, ConfiguredTokens.Scopes))
}

final case class DeclaredTokenConfig(id: String, hashFile: String)
/** A user of the service configuration: `login` and `passwordHashFile` together or neither; `admin` makes the user a
  * declarative account administrator. */
final case class DeclaredUserConfig(id: String, userType: String, displayName: String, tokens: Vector[DeclaredTokenConfig],
  login: Option[String], passwordHashFile: Option[String], enabled: Boolean, admin: Boolean)

/** The loaded declared users: account users for reconciliation, the declared directory and the configured tokens. */
final case class Declared(users: Vector[AccountUser], directory: DeclaredDirectory, tokens: ConfiguredTokens)

object DeclaredUsers {
  private val UserTypes = Set("human", "agent")
  private val PasswordUserType = "human"
  private val MaximumLogin = 128
  private val MaximumUserId = 128
  private val MaximumTokenId = 64

  private def unique(values: Vector[String], refusal: ConfigRefusal): Either[ConfigRefusal, Unit] =
    Either.cond(values.distinct.size == values.size, (), refusal)
  private def check(valid: Boolean, refusal: ConfigRefusal): Either[ConfigRefusal, Unit] = Either.cond(valid, (), refusal)

  // Baseline ECMAScript /[^\\s:]{1,n}/ counts UTF16 units. Java's
  // isWhitespace additionally classifies U+001C..001F as separators and Java
  // regex quantifiers count supplementary code points; neither may alter
  // an acknowledged author/token identity or credential mapping.
  private def idWhitespace(c: Char): Boolean =
    c >= '\u0009' && c <= '\u000d' || c == ' ' || c == '\u00a0' || c == '\u1680' ||
    c >= '\u2000' && c <= '\u200a' || c == '\u2028' || c == '\u2029' ||
    c == '\u202f' || c == '\u205f' || c == '\u3000' || c == '\ufeff'
  private def validId(value: String, max: Int): Boolean = value.nonEmpty && value.length <= max && !value.exists(c => c == ':' || idWhitespace(c))

  /** At least one user, and unique user ids. `load` checks this first, too. */
  def identities(users: Vector[DeclaredUserConfig]): Either[ConfigRefusal, Unit] =
    check(users.nonEmpty, ConfigRefusal.NoUsers) *> unique(users.map(_.id), ConfigRefusal.DuplicateUserId)

  /** Validates the users, reads their password-hash and digest files and refuses a digest that two tokens share. */
  def load(users: Vector[DeclaredUserConfig]): Either[ConfigRefusal, Declared] = for {
    _ <- identities(users)
    _ <- unique(users.flatMap(_.login), ConfigRefusal.DuplicateLogin)
    accountUsers <- users.traverse { user =>
      for {
        _ <- check(user.login.isDefined == user.passwordHashFile.isDefined && !(user.login.isDefined && user.userType != PasswordUserType), ConfigRefusal.InvalidPasswordCredentials)
        _ <- user.login.traverse_(login => check(login.nonEmpty && login.length <= MaximumLogin && login == login.trim && !login.exists(_.isControl), ConfigRefusal.InvalidLogin))
        passwordHash <- user.passwordHashFile.traverse { path =>
          try Right(Password.readHash(Path.of(path))) catch { case _: Exception => Left(ConfigRefusal.InvalidPasswordFile) }
        }
      } yield AccountUser(user.id, user.userType, user.displayName, user.login, passwordHash, user.enabled, AccountOrigin.Declarative)
    }
    entries <- users.flatTraverse { user =>
      for {
        _ <- check(validId(user.id, MaximumUserId) && UserTypes.contains(user.userType), ConfigRefusal.InvalidUser)
        _ <- check(user.tokens.nonEmpty || user.login.nonEmpty, ConfigRefusal.NoCredentials)
        _ <- unique(user.tokens.map(_.id), ConfigRefusal.DuplicateTokenId)
        digests <- user.tokens.traverse { token =>
          check(validId(token.id, MaximumTokenId), ConfigRefusal.InvalidTokenId).flatMap { _ =>
            DigestFile.read(token.hashFile).map(_ -> ConfiguredToken(user.id, user.userType, token.id))
          }
        }
      } yield digests
    }
    _ <- unique(entries.map(_._1), ConfigRefusal.DigestAssignedTwice)
  } yield {
    val directory = DeclaredDirectory(accountUsers, users.filter(_.admin).map(_.id).toSet)
    val enabled = entries.filter { (_, token) => accountUsers.exists(u => u.id == token.userId && u.enabled) }
    Declared(accountUsers, directory, new SnapshotTokens(users, enabled.map((digest, token) => digest.getBytes(StandardCharsets.US_ASCII) -> token)))
  }
}

/** The service's `accounts` settings (design §6.1): imperative accounts. */
final case class ImperativeAccountsConfig(enabled: Boolean, keyFile: Option[String], signupEnabled: Boolean, requireApproval: Boolean,
  maxUsers: Int, enrollmentEnabled: Boolean, enrollmentTtlSeconds: Long, issuer: Option[String], reservedUsernames: Vector[String])

object ImperativeConfig {
  private val NixStore = "/nix/store/"
  /** Design §6.2–§6.3: the creation flags never imply the master switch; the master switch requires the key
    * file, an issuer and an enabled declarative admin; the remaining bounds are checked by `ImperativeSettings`.
    * `None` while the master switch is off. `service` is bound into the associated data of every encrypted TOTP secret.
    */
  def settings(service: String, accounts: Option[ImperativeAccountsConfig], declared: DeclaredDirectory): Either[ConfigRefusal, Option[ImperativeSettings]] =
    accounts match {
      case None => Right(None)
      case Some(a) if !a.enabled => Either.cond(!a.signupEnabled && !a.enrollmentEnabled, None, ConfigRefusal.AccountsFlagsWithoutSwitch)
      case Some(a) => for {
        keyFile <- a.keyFile.filter(path => path.startsWith("/") && !path.startsWith(NixStore)).toRight(ConfigRefusal.AccountsKeyFile)
        issuer <- a.issuer.toRight(ConfigRefusal.AccountsIssuer)
        _ <- Either.cond(declared.users.exists(user => user.enabled && declared.admins(user.id)), (), ConfigRefusal.AccountsAdmin)
      } yield Some(ImperativeSettings(service, a.signupEnabled, a.requireApproval, a.enrollmentEnabled, a.maxUsers,
        java.time.Duration.ofSeconds(a.enrollmentTtlSeconds), issuer, a.reservedUsernames.toSet, TotpVault.load(Path.of(keyFile), service)))
    }
}
