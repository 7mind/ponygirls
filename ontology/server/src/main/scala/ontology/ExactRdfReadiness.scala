package ontology

import cats.effect.IO
import ontology.api.GraphSnapshot
import ontology.domain.{Fault, Require}

trait ExactRdfReadiness {
  def generation(authoritative: GraphSnapshot): IO[Option[Long]]
}

final class LocalExactRdfReadiness(projection: RdfProjection) extends ExactRdfReadiness {
  def generation(authoritative: GraphSnapshot): IO[Option[Long]] = projection.snapshot(authoritative.scope, authoritative.generation).map { projected =>
    Require(projected == authoritative, "projection-conflict", "local RDF cut differs from authority")
    Some(authoritative.generation): Option[Long]
  }.handleErrorWith {
    case fault: Fault if fault.code == "projection-lag" => IO.pure(None)
    case error => IO.raiseError(error)
  }
}
