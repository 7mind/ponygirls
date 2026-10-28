import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__McpTestSnapshot__From__1_6_0
    extends AbstractConversion[v1_6_0.McpTestSnapshot, McpTestSnapshot] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.McpTestSnapshot
      ): McpTestSnapshot = {
        val instanceid: UUID = _from.instanceId
        val runid: UUID = _from.runId
        val state: McpTestState = conversions.convertWithContext[C, v1_6_0.McpTestState, McpTestState](context, _from.state)
        val observedat: String = _from.observedAt
        val events: List[McpTestEvent] = _from.events.map(e1 => conversions.convertWithContext[C, v1_6_0.McpTestEvent, McpTestEvent](context, e1)).toList
        val lastsequence: Long = _from.lastSequence
        val hasmore: Boolean = _from.hasMore
        val failure: Option[Failure] = _from.failure.map(e1 => conversions.convertWithContext[C, v1_6_0.Failure, Failure](context, e1))
        McpTestSnapshot(
                instanceid,
                runid,
                state,
                observedat,
                events,
                lastsequence,
                hasmore,
                failure
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#McpTestSnapshot"
  }
}