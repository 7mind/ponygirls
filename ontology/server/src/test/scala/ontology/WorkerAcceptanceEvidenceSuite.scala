package ontology

import java.util.UUID
import munit.FunSuite

final class WorkerAcceptanceEvidenceSuite extends FunSuite {
  private val first = UUID.fromString("00000000-0000-4000-8000-000000000001")
  private val second = UUID.fromString("00000000-0000-4000-8000-000000000002")
  test("missing tool-result exposure cannot pass via distinct delivery inventory") {
    intercept[IllegalArgumentException] {
      PackagedWorkerAcceptance.exposureIds(List(Nil, List(first), Nil, List(second)))
    }
  }
  test("controlled exposure matrix binds both outputs of the first request") {
    assertEquals(PackagedWorkerAcceptance.exposureIds(List(Nil, List(first), List(first), List(second))), List(first, second))
  }
}
