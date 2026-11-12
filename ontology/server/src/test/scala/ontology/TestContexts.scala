package ontology

import ontology.api.*
import java.util.UUID

object TestContexts {
  def claim(context: CaptureContext): ContextRecordInput = ContextRecordInput(OriginContextInput.ReportedNative(context), Nil)
  def reported(context: CaptureContext): ContextRecord = ContextRecord(OriginContext.ReportedNative(context), Nil)
  def unknown: ContextRecord = ContextRecord(OriginContext.Unknown("Synthetic fixture has no contribution context"), Nil)
  def trace(operation: String): RequestTrace = RequestTrace(UUID.randomUUID(), operation, RequestTransport.Bearer)
  def principal(scope: String, actor: Actor): Principal = Principal("fixture-" + actor.id, actor, Set(scope), Set(Capability.Read, Capability.Mutate))
}
