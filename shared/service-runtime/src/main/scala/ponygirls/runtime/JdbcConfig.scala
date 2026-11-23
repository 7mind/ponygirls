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
/** One process's pool (restart-robustness spec §5): `request + background` connections, the request and the background
  * admission's (background 0: the background view shares the request admission). A `fixed` pool opens every connection at
  * once and keeps them; otherwise it opens them on first use and closes them when idle. */
final case class JdbcPoolSizing private (request: Int, background: Int, fixed: Boolean) {
  def connections: Int = request + background
}
object JdbcPoolSizing {
  /** Connections of `maxConnections` never pooled: one backend exiting during a replacement, one operator session. */
  val headroom = 2
  /** With the keys omitted, a smaller `maxConnections` keeps the compatible sizing (development and test budgets). */
  val partitionedMinimum = 8
  /** Default constructors (rites, ontology, fixtures): one admission of `maxConnections`, opened on first use. */
  def compatible(limits: JdbcLimits): JdbcPoolSizing = JdbcPoolSizing(limits.maxConnections, 0, fixed = false)
  /** The services' sizing from their optional `requestConnections` and `backgroundConnections` keys, set together or
    * omitted: omitted, `maxConnections − headroom` halved (background the smaller half), below [[partitionedMinimum]] the
    * compatible sizing; set, request ≥ 1, background ≥ `minimumBackground` and both together ≤ `maxConnections −
    * headroom`. Left: what is invalid, by key name. */
  def partitioned(limits: JdbcLimits, request: Option[Int], background: Option[Int], minimumBackground: Int): Either[String, JdbcPoolSizing] =
    (request, background) match {
      case (None, None) if limits.maxConnections < partitionedMinimum => Right(compatible(limits))
      case (None, None) =>
        val pooled = limits.maxConnections - headroom
        Right(JdbcPoolSizing(pooled - pooled / 2, pooled / 2, fixed = true))
      case (Some(r), Some(b)) =>
        if (r < 1) Left("requestConnections must be at least 1")
        else if (b < minimumBackground.max(0)) Left(s"backgroundConnections must be at least ${minimumBackground.max(0)}")
        else if (r.toLong + b > limits.maxConnections - headroom) Left(s"requestConnections + backgroundConnections must be at most maxConnections - $headroom")
        else Right(JdbcPoolSizing(r, b, fixed = true))
      case _ => Left("requestConnections and backgroundConnections must be set together")
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
