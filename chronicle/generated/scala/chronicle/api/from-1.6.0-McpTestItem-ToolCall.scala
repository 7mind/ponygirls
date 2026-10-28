import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__McpTestItem__ToolCall__From__1_6_0
    extends AbstractConversion[v1_6_0.McpTestItem.ToolCall, McpTestItem.ToolCall] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.McpTestItem.ToolCall
      ): McpTestItem.ToolCall = {
        val callid: String = _from.callId
        val tool: String = _from.tool
        val partindex: Int = _from.partIndex
        val partcount: Int = _from.partCount
        val argumentsjsonpart: String = _from.argumentsJsonPart
        McpTestItem.ToolCall(
                callid,
                tool,
                partindex,
                partcount,
                argumentsjsonpart
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall"
  }
}