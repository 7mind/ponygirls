package ontology

import cats.effect.IO
import ontology.api.*

trait GraphReadRepository {
  def read(scope: String): IO[GraphSnapshot]
  def input(scope: String, ref: Ref): IO[InputReceipt]
}
