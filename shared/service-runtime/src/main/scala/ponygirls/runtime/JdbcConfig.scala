package ponygirls.runtime

import java.nio.ByteBuffer
import java.nio.charset.{CodingErrorAction, StandardCharsets}
import java.nio.file.{Files, LinkOption, Path, StandardOpenOption}
import scala.concurrent.duration.*
import scala.util.Using

final case class JdbcLimits(
  maxConnections: Int,
  maxQueued: Int,
  queueTimeout: FiniteDuration,
  connectTimeout: FiniteDuration,
  statementTimeout: FiniteDuration,
  lockTimeout: FiniteDuration,
  idleTransactionTimeout: FiniteDuration,
  socketTimeout: FiniteDuration
) {
  def admission: AdmissionConfig = AdmissionConfig(maxConnections, maxQueued, queueTimeout)
  def validate(): Unit = {
    admission.validate()
    List(connectTimeout, statementTimeout, lockTimeout, idleTransactionTimeout, socketTimeout).foreach { d =>
      require(d >= 1.millis && d <= 1.hour, "invalid JDBC timeout")
    }
  }
}
final case class JdbcConfig(jdbcUrl: String, user: String, passwordFile: Path, limits: JdbcLimits) {
  def validate(): Unit = {
    limits.validate()
    // No credential-bearing URLs or arbitrary driver properties that could override bounds.
    require(jdbcUrl.startsWith("jdbc:postgresql://") && !jdbcUrl.exists(c => c == '?' || c == '#' || c == '@' || c.isWhitespace), "invalid JDBC URL")
    val uri = try java.net.URI.create(jdbcUrl.stripPrefix("jdbc:")) catch { case _: IllegalArgumentException => throw RuntimeFailure("jdbc-config") }
    require(uri.getHost != null && uri.getPath != null && uri.getPath.length > 1 && uri.getUserInfo == null, "invalid JDBC URL")
    require(user.nonEmpty && user.length <= 128 && !user.exists(c => c.isControl), "invalid database user")
    require(passwordFile.isAbsolute, "password file must be absolute")
  }
  override def toString: String = "JdbcConfig(<redacted>)"
}

/** Explicit runtime file only. Bounded strict UTF8, one optional terminal newline.
  * Configured references and every containing/resolved directory are trusted operator-owned
  * inputs, not payload paths. Resolve managed symlinks each read (e.g. agenix), then require
  * a regular resolved leaf and open that leaf NOFOLLOW. Operators must not race replacement
  * with a special file; this is not adversarial payload-path confinement.
  */
object BoundedSecretFile {
  def read(path: Path, maxBytes: Int): String = {
    require(maxBytes > 0 && maxBytes <= 1024 * 1024, "invalid secret file bound")
    try {
      if (!path.isAbsolute) throw RuntimeFailure("credential-file")
      val resolved = path.toRealPath()
      if (!Files.isRegularFile(resolved, LinkOption.NOFOLLOW_LINKS)) throw RuntimeFailure("credential-file")
      val bytes = Using.resource(Files.newInputStream(resolved, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS))(_.readNBytes(maxBytes + 1))
      if (bytes.length > maxBytes) throw RuntimeFailure("credential-file")
      StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString
    } catch { case scala.util.control.NonFatal(_) => throw RuntimeFailure("credential-file") }
  }
}
object CredentialFile {
  def read(path: Path): String = {
    val value = BoundedSecretFile.read(path, 16384).stripSuffix("\n").stripSuffix("\r")
    if (value.isEmpty || value.exists(c => c == '\n' || c == '\r' || c == 0)) throw RuntimeFailure("credential-file")
    value
  }
}
