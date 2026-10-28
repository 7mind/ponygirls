import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__McpTestLimits__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.McpTestLimits, McpTestLimits] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.McpTestLimits
      ): McpTestLimits = {
        val maximumrounds: Int = _from.maximumRounds
        val maximumtoolcalls: Int = _from.maximumToolCalls
        val maximumpromptbytes: Int = _from.maximumPromptBytes
        val maximumsourcebytes: Int = _from.maximumSourceBytes
        val maximumresultbytes: Int = _from.maximumResultBytes
        val maximumrequestbytes: Int = _from.maximumRequestBytes
        val maximumtracebytes: Int = _from.maximumTraceBytes
        val maximumevents: Int = _from.maximumEvents
        val pagebytes: Int = _from.pageBytes
        val deadlineseconds: Int = _from.deadlineSeconds
        val retentionseconds: Int = _from.retentionSeconds
        McpTestLimits(
                maximumrounds,
                maximumtoolcalls,
                maximumpromptbytes,
                maximumsourcebytes,
                maximumresultbytes,
                maximumrequestbytes,
                maximumtracebytes,
                maximumevents,
                pagebytes,
                deadlineseconds,
                retentionseconds
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#McpTestLimits"
  }
}