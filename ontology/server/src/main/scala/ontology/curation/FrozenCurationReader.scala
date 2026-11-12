package ontology.curation

import cats.effect.IO
import java.time.Instant
import ontology.*
import ontology.api.*
import ontology.domain.*

final class FrozenCurationReader(frozen: CurationFrozenView, inputs: GraphReadRepository, principal: Principal, cursors: CursorSigner, limits: QueryLimits) extends CurationReader {
  principal.require(frozen.claim.scope, Capability.Read)
  private val reproduced = CurationMaterial.seal(frozen.claim, frozen.snapshot, frozen.material.input.sources,
    Instant.parse(frozen.material.manifest.sealedAt), CurationGuardLimits.retained(frozen.claim))
  Require(reproduced == frozen.material, "curation", "frozen reader material differs from retained input")
  private def scope(value: String): Unit = Require(value == frozen.claim.scope, "curator-snapshot", "reader scope differs from frozen claim")
  private val repository = new GraphReadRepository {
    def read(value: String): IO[GraphSnapshot] = IO { scope(value); frozen.snapshot }
    def input(value: String, ref: Ref): IO[InputReceipt] = IO.defer {
      scope(value)
      inputs.input(value, ref).map { receipt =>
        Require(receipt.scope == frozen.claim.scope && receipt.ref == ref && receipt.generation <= frozen.claim.baseGeneration, "stale-reference", "input identity or generation differs from frozen request")
        receipt
      }
    }
  }
  private val queries = new GraphQueries(repository, cursors, limits)
  def read(request: ReadRequest): IO[ReadResult] = queries.read(principal, request)
  def find(request: FindRequest): IO[FindResult] = queries.find(principal, request)
}
