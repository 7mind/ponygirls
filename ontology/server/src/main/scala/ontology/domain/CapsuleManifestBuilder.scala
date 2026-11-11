package ontology.domain

import ontology.api.*

object CapsuleManifestBuilder {
  def build(material: CapsuleMaterial, plan: CapsulePlan, records: List[GraphRecord], context: ContextRecord, workContext: String, changes: CapsuleChangeSet): CapsuleManifest = {
    CapsuleRecords.structure(material, records)
    val graph = material.snapshot
    val accounts = (plan.roots.map(_.ref) ++ changes.changes.map(_.account)).distinct
    val human = accounts.map(ref => ref -> CapsuleAttribution.humanBasis(ref, records)).toMap
    val humanInputs = human.values.flatten.toSet
    val enriched = changes.changes.map(c => c.copy(humanBasis = human(c.account)))
    var qualifications = changes.qualifications
    def qualify(code: CapsuleQualificationCode, refs: List[Ref]): Unit = { qualifications :+= CapsuleQualification(code, refs.distinct.sortBy(CapsuleSelection.order)) }
    if (graph.coveredFrontier < graph.sourceFrontier) qualify(CapsuleQualificationCode.CoverageLag, material.pending.map(e => Ref(e.id, 1)))
    if (material.cut.lastPublicationGeneration.isEmpty) qualify(CapsuleQualificationCode.NoCurationPublication, Nil)
    if (material.cut.lastPublicationGeneration.exists(_ < graph.generation)) qualify(CapsuleQualificationCode.GraphChangedAfterCuration, Nil)
    if (context.origin.isInstanceOf[OriginContext.Unknown]) qualify(CapsuleQualificationCode.ReportedContextUnknown, Nil)
    accounts.filter(ref => human(ref).isEmpty).foreach(ref => qualify(CapsuleQualificationCode.MissingHumanBasis, List(ref)))
    def historical(record: GraphRecord): Boolean = plan.historical.contains(Graph.recordRef(record)) || (record match {
      case GraphRecord.Node(v) => !Graph.current(graph, v.ref) || v.standing != Standing.Active
      case GraphRecord.Edge(v) => !Graph.current(graph, v.ref) || v.standing != Standing.Active
      case GraphRecord.Contract(v) => !Selections.selected(graph, v)
      case GraphRecord.Progress(v) => !Graph.latestEvent(graph, v.subject).contains(v) || !Selections.selected(graph, Graph.binding(graph, v.subject))
      case GraphRecord.Selection(v) => !Selections.latest(graph).contains(v)
      case _ => false
    })
    val roots = plan.roots.map(root => root.ref -> root.partition).toMap
    val entries = records.map { record =>
      val ref = Graph.recordRef(record)
      record match {
        case GraphRecord.Node(v) =>
          if (v.applicability.isInstanceOf[Applicability.Unresolved]) qualify(CapsuleQualificationCode.UnresolvedApplicability, List(ref))
          if (CapsuleSelection.intent(v) && Graph.current(graph, ref) && !graph.bindings.exists(b => b.definition == ref && b.workContext == workContext && Selections.selected(graph, b)))
            qualify(CapsuleQualificationCode.UnboundIntent, List(ref))
          v.content match {
            case c: Content.Conflict if c.status == ConflictState.Open => qualify(CapsuleQualificationCode.UnresolvedConflict, List(ref))
            case _ => ()
          }
        case GraphRecord.Edge(v) => if (v.applicability.isInstanceOf[Applicability.Unresolved]) qualify(CapsuleQualificationCode.UnresolvedApplicability, List(ref))
        case GraphRecord.Contract(v) => if (Selections.selected(graph, v) && !CapsuleRecords.bindingCurrent(graph, v)) qualify(CapsuleQualificationCode.StaleBinding, List(ref))
        case GraphRecord.Progress(v) => if (plan.currentBindings.contains(v.subject) && Gates.requiresWarrant(v.phase) && !CapsuleRecords.warrantCurrent(graph, v)) qualify(CapsuleQualificationCode.StaleWarrant, List(ref))
        case _ => ()
      }
      val old = historical(record)
      if (old) qualify(CapsuleQualificationCode.HistoricalEvidence, List(ref))
      val partition = if (plan.selected.contains(ref)) CapsulePartition.SelectedWorkContext else roots.get(ref) match {
        case Some(CapsulePartition.UnresolvedScopeContext) => CapsulePartition.UnresolvedScopeContext
        case _ => if (old) CapsulePartition.HistoricalContext else CapsulePartition.SupportingContext
      }
      val incoming = records.collect { case GraphRecord.Edge(edge) if CapsuleAttribution.LineageKinds.contains(edge.kind) && edge.targets.contains(ref) => edge.ref }
      val evidence = (CapsuleAttribution.evidence(record) ++ RecordLinks.provenance(record).toList.map(p => Ref(p.input, 1)) ++ incoming).distinct.sortBy(CapsuleSelection.order)
      CapsuleManifestEntry(ref, partition, CapsuleAttribution.roles(record, records, humanInputs), evidence)
    }
    val present = records.map(Graph.recordRef).toSet
    Require(entries.flatMap(_.evidence).forall(present), "corrupt", "capsule manifest evidence is not in its payload")
    val ordered = qualifications.distinct.sortBy(q => (q.code.toString, q.subjects.map(r => r.id.toString + ":" + r.revision).mkString("|")))
    CapsuleManifest(entries, enriched, ordered)
  }
}
