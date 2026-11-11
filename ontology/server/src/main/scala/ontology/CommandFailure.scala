package ontology

import java.util.IdentityHashMap
import ontology.domain.Fault
import scala.collection.mutable

private[ontology] object CommandFailure {
  private val MaximumNodes = 32
  private val MaximumChildren = 32
  private val Unknown = "startup-or-runtime-failed"
  def render(error: Throwable): String = {
    val visited = new IdentityHashMap[Throwable, java.lang.Boolean]()
    val pending = mutable.Queue(error)
    val codes = List.newBuilder[String]
    var incomplete = false
    while (pending.nonEmpty && visited.size < MaximumNodes) {
      val current = pending.dequeue()
      if (!visited.containsKey(current)) {
        visited.put(current, java.lang.Boolean.TRUE)
        current match {
          case fault: Fault if fault.code.matches("[a-z][a-z0-9-]{0,63}") => codes += fault.code
          case _ if current eq error => codes += Unknown
          case _ => ()
        }
        Option(current.getCause).foreach(pending.enqueue(_))
        val suppressed = current.getSuppressed
        if (suppressed.length > MaximumChildren) incomplete = true
        suppressed.take(MaximumChildren).foreach(pending.enqueue(_))
      }
    }
    incomplete = incomplete || pending.nonEmpty
    val retained = codes.result().distinct
    val summary = retained ++ (if (incomplete) List("error-summary-incomplete") else Nil)
    "ontology-server: " + summary.mkString(", ")
  }
}
