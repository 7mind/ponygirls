import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__ReadMcpTest__From__1_7_0
    extends AbstractConversion[v1_7_0.Operation.ReadMcpTest, Operation.ReadMcpTest] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.Operation.ReadMcpTest
      ): Operation.ReadMcpTest = {
        val instanceid: UUID = _from.instanceId
        val runid: UUID = _from.runId
        val aftersequence: Long = _from.afterSequence
        val limit: Int = _from.limit
        Operation.ReadMcpTest(
                instanceid,
                runid,
                aftersequence,
                limit
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#ReadMcpTest"
  }
}