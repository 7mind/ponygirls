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

/** Explicit runtime file only. Bounded strict UTF8, one optional terminal newline, no symlink.
  * The operator owns file/directory permissions (including systemd credentials directories).
  */
object CredentialFile {
  def read(path: Path): String = {
    try {
      val bytes = Using.resource(Files.newInputStream(path, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS))(_.readNBytes(16385))
      if (bytes.isEmpty || bytes.length > 16384) throw RuntimeFailure("credential-file")
      val decoded = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString
      val value = decoded.stripSuffix("\n").stripSuffix("\r")
      if (value.isEmpty || value.exists(c => c == '\n' || c == '\r' || c == 0)) throw RuntimeFailure("credential-file")
      value
    } catch { case scala.util.control.NonFatal(_) => throw RuntimeFailure("credential-file") }
  }
}
