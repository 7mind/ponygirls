package ponygirls.runtime

import java.util.{ArrayDeque, Collections, IdentityHashMap, Locale}

/** The printable cause of a failed start or run: a code, the simple class name of the chosen cause and a fixed message.
  * It never holds an exception message of its own, a cause chain, a stack trace, a path, SQL, a URL or a config value.
  */
final case class StartFailure(code: String, errorClass: String, message: String)

object StartFailure {
  /** A service's own failure types as (code, message). The message must be a fixed text that carries no value. */
  type Known = PartialFunction[Throwable, (String, String)]

  val Internal = "internal"
  val AddressInUse = "address-in-use"
  val Bind = "bind"
  /** Throwables the walk queues, and cause/suppressed edges it inspects, at most; a larger graph ends as `internal`. */
  private[runtime] val MaxCauses = 64
  private[runtime] val MaxEdges = 256
  private val Unexpected = "unexpected failure"
  private val AddressInUseWordings = List("address already in use", "address in use")
  private val SafeCode = "[a-z][a-z0-9-]{0,63}"
  private val SqlState = "[A-Z0-9]{5}"
  private val JdbcCode = s"jdbc-$SqlState"

  private val runtime: Known = {
    case bind: java.net.BindException if Option(bind.getMessage).map(_.toLowerCase(Locale.ROOT)).exists(text => AddressInUseWordings.exists(text.contains)) =>
      (AddressInUse, "address in use")
    case _: java.net.BindException => (Bind, "bind failed")
    case jdbc: JdbcFailure if jdbc.code.matches(SafeCode) => ("jdbc-" + jdbc.sqlState.filter(_.matches(SqlState)).getOrElse("unknown"), jdbc.code)
    case failure: RuntimeFailure => (failure.code, failure.code)
    case _: java.net.ConnectException => ("connect", "connection refused")
    case _: java.net.SocketTimeoutException | _: java.util.concurrent.TimeoutException => ("timeout", "timed out")
  }

  /** The first known failure, breadth-first over causes AND suppressed exceptions (distage keeps a provisioning failure
    * only as a suppressed exception of an izumi.* wrapper whose cause is null); otherwise `internal`. Each throwable is
    * queued once; the walk stops admitting work after [[MaxCauses]] throwables or [[MaxEdges]] edges.
    */
  def classify(error: Throwable, known: Known): StartFailure = {
    val queued = Collections.newSetFromMap(new IdentityHashMap[Throwable, java.lang.Boolean]())
    val pending = new ArrayDeque[Throwable]()
    var edges = 0
    def admitting: Boolean = queued.size < MaxCauses && edges < MaxEdges
    def enqueue(next: Throwable): Unit = if (next != null && admitting) {
      edges += 1
      if (queued.add(next)) pending.add(next)
    }
    val chosen = runtime.orElse(known)
    @annotation.tailrec def loop(): StartFailure = Option(pending.poll()) match {
      case None => StartFailure(Internal, className(error), Unexpected)
      case Some(head) => chosen.lift(head).filter((code, _) => code.matches(SafeCode) || code.matches(JdbcCode)) match {
        case Some((code, message)) => StartFailure(code, className(head), message)
        case None =>
          enqueue(head.getCause)
          if (admitting) head.getSuppressed.iterator.takeWhile(_ => admitting).foreach(enqueue)
          loop()
      }
    }
    enqueue(error)
    loop()
  }

  /** One line: `<service> failure stage=<stage> code=<code> error=<Class> message="<text>"`, and ` port=<port>` when the
    * failure is the listener's bind (`port` is the listen port of the stage that binds; other failures never print it).
    */
  def line(service: String, stage: String, failure: StartFailure, port: Option[Int]): String = {
    val message = failure.message.map(c => if (c == '"') '\'' else if (c.isControl) ' ' else c)
    val bound = port.filter(_ => failure.code == AddressInUse || failure.code == Bind)
    s"""$service failure stage=$stage code=${failure.code} error=${failure.errorClass} message="$message"""" + bound.fold("")(" port=" + _)
  }

  /** cats-effect hands IOApp's `reportFailure` the failures no fiber observed. A failed listener acquisition reaches both
    * that hook (Ember's background fiber) and the command's handler, in either order. Reports are held until the command
    * settles; then the failure the handler reports (the same instance) is dropped and every other report is printed. */
  final class Unobserved(print: Throwable => Unit) {
    private var held: Option[Vector[Throwable]] = Some(Vector.empty)
    private var handled: Option[Throwable] = None
    def start(): Unit = synchronized { held = Some(Vector.empty); handled = None }
    def report(error: Throwable): Unit = synchronized {
      held match {
        case Some(errors) if errors.size < MaxCauses => held = Some(errors :+ error)
        case _ => if (!handled.exists(_ eq error)) print(error)
      }
    }
    def settle(failure: Option[Throwable]): Unit = synchronized {
      handled = failure
      held.foreach(_.filterNot(error => failure.exists(_ eq error)).foreach(print))
      held = None
    }
  }

  private def className(error: Throwable): String = {
    val simple = error.getClass.getSimpleName
    if (simple.nonEmpty) simple else error.getClass.getName.split('.').last
  }
}
