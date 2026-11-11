package ontology

import cats.effect.IO

trait ScopeCatalog {
  def scopes(principal: Principal): IO[List[String]]
}
