package ontology.domain

import ontology.api.*
import java.util.UUID

object Selections {
  private final case class Key(scope: String, context: String, definition: UUID)
  private def key(binding: Binding): Key = Key(binding.scope, binding.workContext, binding.definition.id)
  def latest(graph: GraphSnapshot): List[BindingSelection] =
    graph.selections.reverse.distinctBy(value => key(Graph.binding(graph, value.binding))).reverse
  def current(graph: GraphSnapshot, binding: Binding): Option[BindingSelection] =
    graph.selections.reverseIterator.find(value => key(Graph.binding(graph, value.binding)) == key(binding))
  def selected(graph: GraphSnapshot, binding: Binding): Boolean =
    current(graph, binding).exists(value => value.selected && value.binding == binding.ref)
}
