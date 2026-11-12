package ontology.domain

import ontology.api.*

private[domain] object PresentationRecords {
  private def check(value: Boolean, message: String): Unit = Require(value, "presentation", message)
  // Inheritance cuts name their own namespaces; input receipts are outside GraphSnapshot.
  def references(record: GraphRecord, scope: String): List[Ref] = {
    record match {
      case GraphRecord.Input(_) => throw Fault("presentation", "input receipt bodies are outside GraphSnapshot")
      case _ => check(RecordLinks.scope(record).forall(_ == scope), "record scope mismatch")
    }
    RecordLinks.references(record)
  }
  def lookup(records: List[GraphRecord]): Ref => GraphRecord = {
    val pairs = records.map(record => Graph.recordRef(record) -> record)
    check(pairs.map(_._1).distinct.size == pairs.size, "duplicate exact record identity")
    val index = pairs.toMap
    ref => index.getOrElse(ref, throw Fault("presentation", "missing exact presentation record"))
  }
  def manifest(targets: List[Ref], get: Ref => GraphRecord, reserved: Ref): PresentationManifest = {
    def alternatives(definition: Ref, target: Ref): List[PresentedSelection] = {
      val values = get(definition) match {
        case GraphRecord.Node(value) => value.content match {
          case question: Content.Question => question.alternatives
          case decision: Content.Decision => decision.alternatives
          case _ => Nil
        }
        case _ => throw Fault("presentation", "binding definition is not a definition record")
      }
      values.zipWithIndex.map { case (label, index) => PresentedSelection.Alternative(target, definition, index, label) }
    }
    val choices: List[PresentedSelection] = targets.flatMap { ref => get(ref) match {
      case GraphRecord.Contract(value) => PresentedSelection.Whole(ref) :: alternatives(value.definition, ref)
      case GraphRecord.Node(value) => value.content match {
        case _: Content.Source => List(PresentedSelection.Whole(ref))
        case _: Content.Question | _: Content.Decision => alternatives(value.ref, reserved)
        case _ => Nil
      }
      case _ => Nil
    } }
    PresentationManifest(choices, choices.collect { case value: PresentedSelection.Whole => value.target })
  }
  def sources(records: List[GraphRecord]): List[Ref] = records.collect {
    case GraphRecord.Node(value) if value.content.isInstanceOf[Content.Source] => value.ref
  }
}
