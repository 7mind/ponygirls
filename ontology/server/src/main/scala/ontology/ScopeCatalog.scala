package ontology

import cats.effect.IO
import ontology.api.Capability
import ontology.domain.Require

trait ScopeCatalog {
  def scopes(principal: Principal): IO[List[String]]
}

final class GrantedScopeCatalog extends ScopeCatalog {
  def scopes(principal: Principal): IO[List[String]] = IO {
    Require(principal.capabilities.contains(Capability.Read), "forbidden", "scope catalog requires Read")
    principal.scopes.toList.sorted
  }
}
