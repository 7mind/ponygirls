import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__McpTestCatalog__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.McpTestCatalog, McpTestCatalog] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.McpTestCatalog
      ): McpTestCatalog = {
        val instanceid: UUID = _from.instanceId
        val model: String = _from.model
        val modelrevision: String = _from.modelRevision
        val maximumoutputtokens: Int = _from.maximumOutputTokens
        val reasoningpolicy: String = _from.reasoningPolicy
        val limits: McpTestLimits = conversions.convertWithContext[C, chronicle.api.v1_4_0.McpTestLimits, McpTestLimits](context, _from.limits)
        val tools: List[McpToolDefinition] = _from.tools.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_4_0.McpToolDefinition, McpToolDefinition](context, e1)).toList
        McpTestCatalog(
                instanceid,
                model,
                modelrevision,
                maximumoutputtokens,
                reasoningpolicy,
                limits,
                tools
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#McpTestCatalog"
  }
}