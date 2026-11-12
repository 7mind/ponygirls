package ontology.domain

import ontology.api.*

object Applicabilities {
  def references(value: Applicability): List[Ref] = value match {
    case v: Applicability.Unresolved => v.basis ++ contexts(v.context)
    case v: Applicability.Declared => v.basis ++ contexts(v.context)
    case v: Applicability.Captured => List(v.source)
  }
  private def contexts(values: List[ApplicabilityContext]): List[Ref] = values.map {
    case ApplicabilityContext.Capture(source) => source
    case ApplicabilityContext.Subject(ref) => ref
  }
  def validate(graph: GraphSnapshot, value: Applicability, allowCaptured: Boolean): Unit = {
    def source(ref: Ref): Unit = Require(Graph.node(graph, ref).content.isInstanceOf[Content.Source], "applicability", "applicability capture anchor must be an exact source")
    def account(text: String, basis: List[Ref], context: List[ApplicabilityContext]): Unit = {
      Require(text.trim.nonEmpty, "applicability", "applicability statement or unresolved reason required")
      Require(basis.distinct.size == basis.size && context.distinct.size == context.size, "applicability", "duplicate applicability anchors")
      basis.foreach(source)
      context.foreach {
        case ApplicabilityContext.Capture(ref) => source(ref)
        case ApplicabilityContext.Subject(ref) => Require(Graph.exists(graph, ref), "reference", "applicability subject not found in namespace")
      }
    }
    value match {
      case v: Applicability.Unresolved => account(v.reason, v.basis, v.context)
      case v: Applicability.Declared => account(v.statement, v.basis, v.context)
      case v: Applicability.Captured =>
        Require(allowCaptured, "protected", "captured applicability is host-owned")
        source(v.source)
    }
  }
}
