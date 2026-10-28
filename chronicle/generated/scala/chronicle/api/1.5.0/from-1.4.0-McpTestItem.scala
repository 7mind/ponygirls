import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__McpTestItem__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.McpTestItem, McpTestItem] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: chronicle.api.v1_4_0.McpTestItem
      ): McpTestItem = from match {
        case x: chronicle.api.v1_4_0.McpTestItem.ToolCall => conversions.convertWithContext[C, chronicle.api.v1_4_0.McpTestItem.ToolCall, McpTestItem.ToolCall](context, x)
        case x: chronicle.api.v1_4_0.McpTestItem.ToolResult => conversions.convertWithContext[C, chronicle.api.v1_4_0.McpTestItem.ToolResult, McpTestItem.ToolResult](context, x)
        case x: chronicle.api.v1_4_0.McpTestItem.Response => conversions.convertWithContext[C, chronicle.api.v1_4_0.McpTestItem.Response, McpTestItem.Response](context, x)
        case other => throw new IllegalArgumentException(s"Bad input: $other")
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#McpTestItem"
  }
}