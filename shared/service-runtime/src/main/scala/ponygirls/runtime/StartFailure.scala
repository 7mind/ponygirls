package ponygirls.runtime

import java.util.{Collections, IdentityHashMap, Locale}

/** The printable cause of a failed start or run: a code, the simple class name of the chosen cause and a fixed message.
  * It never holds an exception message of its own, a cause chain, a stack trace, a path, SQL, a URL or a config value.
  */
final case class StartFailure(code: String, errorClass: String, message: String)

object StartFailure {
  /** A service's own failure types as (code, message). The message must be a fixed text that carries no value. */
  type Known = PartialFunction[Throwable, (String, String)]

  val Internal = "internal"
  private val Unexpected = "unexpected failure"
  private val SafeCode = "[a-z][a-z0-9-]{0,63}"
  private val SqlState = "[A-Z0-9]{5}"
  private val JdbcCode = s"jdbc-$SqlState"

  private val runtime: Known = {
    case bind: java.net.BindException if Option(bind.getMessage).exists(_.toLowerCase(Locale.ROOT).contains("address already in use")) =>
      ("address-in-use", "address in use")
    case _: java.net.BindException => ("bind", "bind failed")
    case jdbc: JdbcFailure if jdbc.code.matches(SafeCode) => ("jdbc-" + jdbc.sqlState.filter(_.matches(SqlState)).getOrElse("unknown"), jdbc.code)
    case failure: RuntimeFailure => (failure.code, failure.code)
    case _: java.net.ConnectException => ("connect", "connection refused")
    case _: java.net.SocketTimeoutException | _: java.util.concurrent.TimeoutException => ("timeout", "timed out")
  }

  /** The first known failure, breadth-first over causes AND suppressed exceptions (distage keeps a provisioning failure
    * only as a suppressed exception of an izumi.* wrapper whose cause is null); otherwise `internal`.
    */
  def classify(error: Throwable, known: Known): StartFailure = {
    val seen = Collections.newSetFromMap(new IdentityHashMap[Throwable, java.lang.Boolean]())
    val chosen = runtime.orElse(known)
    @annotation.tailrec def loop(pending: List[Throwable]): StartFailure = pending match {
      case Nil => StartFailure(Internal, className(error), Unexpected)
      case head :: rest if !seen.add(head) => loop(rest)
      case head :: rest => chosen.lift(head).filter((code, _) => code.matches(SafeCode) || code.matches(JdbcCode)) match {
        case Some((code, message)) => StartFailure(code, className(head), message)
        case None => loop(rest ++ Option(head.getCause).toList ++ head.getSuppressed.toList)
      }
    }
    loop(List(error))
  }

  /** One line: `<service> failure stage=<stage> code=<code> error=<Class> message="<text>"` and, for a stage that binds
    * the listen port, ` port=<port>`.
    */
  def line(service: String, stage: String, failure: StartFailure, port: Option[Int]): String = {
    val message = failure.message.map(c => if (c == '"') '\'' else if (c.isControl) ' ' else c)
    s"""$service failure stage=$stage code=${failure.code} error=${failure.errorClass} message="$message"""" + port.fold("")(" port=" + _)
  }

  private def className(error: Throwable): String = {
    val simple = error.getClass.getSimpleName
    if (simple.nonEmpty) simple else error.getClass.getName.split('.').last
  }
}
