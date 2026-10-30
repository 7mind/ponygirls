import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_7_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__McpTestEvent__From__1_6_0
    extends AbstractConversion[chronicle.api.v1_6_0.McpTestEvent, McpTestEvent] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_6_0.McpTestEvent
      ): McpTestEvent = {
        val sequence: Long = _from.sequence
        val observedat: String = _from.observedAt
        val item: McpTestItem = conversions.convertWithContext[C, chronicle.api.v1_6_0.McpTestItem, McpTestItem](context, _from.item)
        McpTestEvent(
                sequence,
                observedat,
                item
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#McpTestEvent"
  }
}