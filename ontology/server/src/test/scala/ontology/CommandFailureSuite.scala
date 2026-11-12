package ontology

import munit.FunSuite
import ontology.domain.Fault

final class CommandFailureSuite extends FunSuite {
  test("nested qualified causes are preserved without supplied messages") {
    val primary = Fault("curation-work-uncertain", "synthetic-private-value")
    primary.addSuppressed(Fault("curation-diagnostic", "synthetic-private-value"))
    val wrapped = new IllegalStateException("synthetic-private-value", primary)
    val rendered = CommandFailure.render(wrapped)
    assert(rendered.contains("startup-or-runtime-failed"))
    assert(rendered.contains("curation-work-uncertain"))
    assert(rendered.contains("curation-diagnostic"))
    assert(!rendered.contains("synthetic-private-value"))
  }
  test("cyclic error graphs terminate and repeated codes are not duplicate evidence") {
    val a = Fault("first", "private-a"); val b = Fault("second", "private-b")
    a.initCause(b); b.initCause(a); a.addSuppressed(b)
    assertEquals(CommandFailure.render(a), "ontology-server: first, second")
  }
  test("bounded summaries disclose incomplete traversal and reject unsafe codes") {
    val error = Fault("unsafe secret code", "private")
    (0 until 100).foreach(i => error.addSuppressed(Fault("failure-" + i, "private")))
    val rendered = CommandFailure.render(error)
    assert(rendered.contains("startup-or-runtime-failed"))
    assert(rendered.contains("error-summary-incomplete"))
    assert(!rendered.contains("unsafe secret code"))
    assert(!rendered.contains("private"))
    assert(rendered.length < 4096)
  }
}
