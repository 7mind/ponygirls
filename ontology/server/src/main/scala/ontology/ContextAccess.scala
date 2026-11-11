package ontology

import ontology.api.*
import ontology.domain.Contexts

final case class ContextSnapshotKey(scope: String, generation: Long)

object ContextAccess {
  def requiredSnapshots(principal: Principal, contexts: List[ContextRecord]): List[ContextSnapshotKey] = {
    contexts.foreach(Contexts.validateShape(_, Contexts.ProtocolLimits))
    val cuts = contexts.flatMap(_.reportedInherited)
    cuts.map(_.sourceScope).distinct.foreach(principal.require(_, Capability.Read))
    cuts.map(cut => ContextSnapshotKey(cut.sourceScope, cut.generation)).distinct
  }
  def validate(contexts: List[ContextRecord], snapshots: List[GraphSnapshot]): Unit =
    contexts.foreach(Contexts.validateInherited(_, snapshots, Contexts.ProtocolLimits))
}
