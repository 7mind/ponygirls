import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__McpToolDefinition__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.McpToolDefinition, McpToolDefinition] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.McpToolDefinition
      ): McpToolDefinition = {
        val name: String = _from.name
        val description: String = _from.description
        val inputschemajson: String = _from.inputSchemaJson
        McpToolDefinition(
                name,
                description,
                inputschemajson
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/:#McpToolDefinition"
  }
}