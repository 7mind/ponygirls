import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__StartMcpTest__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.Operation.StartMcpTest, Operation.StartMcpTest] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.Operation.StartMcpTest
      ): Operation.StartMcpTest = {
        val instanceid: UUID = _from.instanceId
        val runid: UUID = _from.runId
        val prompt: String = _from.prompt
        Operation.StartMcpTest(
                instanceid,
                runid,
                prompt
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#StartMcpTest"
  }
}