package ontology

import cats.effect.IO
import java.util.UUID
import ontology.api.*
import ontology.domain.*

private[ontology] final class CapsuleStore(transactions: CapsuleTransactions, settings: CapsuleStoreSettings,
                                          reads: CurationReadModel, validation: CurationValidation) extends CapsuleRepository {
  private def loader(tx: CapsuleTransaction, principal: Principal): CapsuleLoading = new CapsuleLoading(tx, principal, settings, reads, validation)
  private def required(value: Option[CapsuleBaseline]): CapsuleBaseline = value.getOrElse(throw Fault("invariant", "capsule chain produced no artifact"))
  def prepare(request: CapsuleRequest, call: ServiceCall, hostId: UUID): IO[Capsule] = IO.defer {
    call.principal.require(request.scope, Capability.Read)
    transactions.run(request.scope) { tx =>
      val load = loader(tx, call.principal)
      tx.capsuleRequest(request.scope, call.principal.actor, request.requestId) match {
        case Some(row) =>
          Require(row.value.owner == call.principal.actor && row.request.scope == request.scope && row.request.requestId == request.requestId,
            "corrupt", "capsule request lookup differs")
          CapsuleRows.capsule(row)
          Require(row.request == request && row.requestDigest == CapsuleRows.digest(request), "replay-conflict", "capsule request ID has different content")
          val chain = load.chain(request.scope, Some(row.value.id), 0)
          val result = required(load.baseline(chain, load.contexts(chain, Nil))).capsule
          Require(result == row.value, "corrupt", "capsule replay row differs")
          result
        case None =>
          CapsuleContext.authorize(call, request.scope, request.workContext, settings.projection)
          Require(tx.capsule(request.scope, hostId).isEmpty, "identity", "capsule identity already exists")
          val chain = load.chain(request.scope, request.previousCapsuleId, 1)
          val context = CapsuleContext.reported(request.reportedContext)
          val contexts = load.contexts(chain, List(context))
          val previous = load.baseline(chain, contexts)
          val current = load.current(request.scope)
          Require(request.expectedFrontier == current.snapshot.sourceFrontier, "stale-frontier", "capsule frontier changed")
          val at = tx.now
          val cut = CapsuleContext.cut(current.status)
          val graph = load.cut(request.scope, cut, at)
          val material = load.material(graph, cut, request.workContext, previous, settings.projection.limits, contexts)
          val value = CapsuleProjection.prepare(material, request, call, hostId, at, settings.projection, previous)
          CapsuleBaseline.validated(value, material, previous)
          val row = CapsuleRow(request, CapsuleRows.digest(request), value)
          CapsuleRows.capsule(row)
          tx.insertCapsule(row)
          value
      }
    }
  }
  def capsule(principal: Principal, scope: String, id: UUID): IO[Capsule] = IO.defer {
    principal.require(scope, Capability.Read)
    transactions.run(scope) { tx =>
      val load = loader(tx, principal)
      val chain = load.chain(scope, Some(id), 0)
      required(load.baseline(chain, load.contexts(chain, Nil))).capsule
    }
  }
  private def retainedDelivery(tx: CapsuleTransaction, principal: Principal, row: DeliveryRow): DeliveryReceipt = {
    CapsuleRows.delivery(row)
    Require(row.value.owner == principal.actor, "forbidden", "delivery belongs to another authenticated actor")
    val load = loader(tx, principal)
    val chain = load.chain(row.value.scope, Some(row.value.capsuleId), 0)
    val contexts = load.contexts(chain, List(row.value.reportedContext))
    val baseline = required(load.baseline(chain, contexts))
    load.cut(row.value.scope, row.value.observedCut, CapsuleRows.time(row.value.receivedAt))
    DeliveryEngine.validate(row.value, row.request, baseline, contexts)
    row.value
  }
  def recordDelivery(request: DeliveryRequest, call: ServiceCall, hostId: UUID): IO[DeliveryReceipt] = IO.defer {
    call.principal.require(request.scope, Capability.Read)
    transactions.run(request.scope) { tx =>
      tx.deliveryRequest(request.scope, call.principal.actor, request.requestId) match {
        case Some(row) =>
          Require(row.value.owner == call.principal.actor && row.request.scope == request.scope && row.request.requestId == request.requestId,
            "corrupt", "delivery request lookup differs")
          CapsuleRows.delivery(row)
          Require(row.request == request && row.requestDigest == CapsuleRows.digest(request), "replay-conflict", "delivery request ID has different content")
          retainedDelivery(tx, call.principal, row)
        case None =>
          Require(tx.delivery(request.scope, hostId).isEmpty, "identity", "delivery identity already exists")
          val load = loader(tx, call.principal)
          val chain = load.chain(request.scope, Some(request.capsuleId), 0)
          val contexts = load.contexts(chain, List(CapsuleContext.reported(request.reportedContext)))
          val baseline = required(load.baseline(chain, contexts))
          val current = load.current(request.scope)
          val at = tx.now
          val cut = CapsuleContext.cut(current.status)
          load.cut(request.scope, cut, at)
          val value = DeliveryEngine.record(request, call, baseline, cut, contexts, hostId, at)
          val row = DeliveryRow(request, CapsuleRows.digest(request), value)
          CapsuleRows.delivery(row)
          DeliveryEngine.validate(value, request, baseline, contexts)
          tx.insertDelivery(row)
          value
      }
    }
  }
  def delivery(principal: Principal, scope: String, id: UUID): IO[DeliveryReceipt] = IO.defer {
    principal.require(scope, Capability.Read)
    transactions.run(scope) { tx =>
      val row = tx.delivery(scope, id).getOrElse(throw Fault("not-found", "delivery not found"))
      Require(row.value.scope == scope && row.value.id == id, "corrupt", "delivery row lookup differs")
      retainedDelivery(tx, principal, row)
    }
  }
}
