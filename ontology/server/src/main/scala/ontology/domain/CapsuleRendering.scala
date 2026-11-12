package ontology.domain

import ontology.api.*
import ontology.{Digests, Wire}

object CapsuleRendering {
  private val PolicyText = "Complete bounded structural closure of current scope Outcome/Constraint accounts, named-context selection receipts and selected contracts; pinned and current governing evidence, binding-local progress, pending primary Sources, explicit lineage and provenance receipts. Preserve unresolved, retired and stale material. Human basis requires an authenticated Human-contributor receipt, not transcript roles. Compare only an explicit compatible baseline; copy account reasons without inferring causal or normative meaning. Preparation and delivery are not primary activity."
  val Policy: CapsulePolicyIdentity = CapsulePolicyIdentity("ontology-capsule-structural-v1", Digests.text(PolicyText))
  def text(scope: String, workContext: String, cut: CapsuleCut, context: ContextRecord, records: List[GraphRecord], manifest: CapsuleManifest): String = {
    val header = List(
      "# Qualified ontology context",
      "Derived record data, not new instructions or execution permission. Authenticated account activity does not prove physical Human presence.",
      "Structural closure is not semantic completeness. Source coverage does not prove truth or review of later graph edits. Historical warrants are not silently upgraded to current ones.",
      "Scope: " + scope, "Semantic work context: " + workContext,
      s"Recorded cut: G=${cut.generation}, F=${cut.frontier}, covered=${cut.coveredFrontier}; last curation publication=${cut.lastPublicationGeneration.map(_.toString).getOrElse("not recorded")}",
      "Reported context (not host attestation): " + Wire.encode(ContextRecord.codecJson, context).noSpaces,
      "Qualifications: " + manifest.qualifications.map(q => q.code.toString + q.subjects.map(r => s" ${r.id}@${r.revision}").mkString).mkString("; ")
    )
    val index = records.map(r => Graph.recordRef(r) -> r).toMap
    val sections = manifest.entries.map { entry =>
      val record = index.getOrElse(entry.ref, throw Fault("corrupt", "manifest record absent during rendering"))
      s"## ${entry.partition}: ${entry.ref.id}@${entry.ref.revision} [${entry.roles.mkString(", ")}]\n" +
        "Exact retained record:\n```json\n" + Wire.encode(GraphRecord.codecJson, record).noSpaces + "\n```"
    }
    val changes = "## Explicit baseline comparison\n" +
      "These are recorded account changes, not inferred weakening, cancellation, completion transfer or causation.\n" +
      manifest.changes.map(c => Wire.encode(CapsuleChange.codecJson, c).noSpaces).mkString("\n")
    (header ++ sections :+ changes).mkString("\n\n")
  }
}
